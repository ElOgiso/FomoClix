/**
 * FOMOCLIX Sell Execution Router
 * Decides whether a token is a Zora Creator/Content Coin or a standard Base ERC-20 / Aerodrome / Uniswap token,
 * and routes the sell execution to the appropriate engine.
 */

const { ethers, getAddress } = require('ethers');

const WETH_BASE = getAddress('0x4200000000000000000000000000000000000006');
const USDC_BASE = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

const UNISWAP_V3_QUOTER = getAddress('0x3d4e44eb1374240ce5f1b871ab261cd16335b76a');
const UNISWAP_V3_ROUTER = getAddress('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');

const AERODROME_ROUTER = getAddress('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43');
const AERODROME_FACTORY = getAddress('0x420DD381b31aEf6683db6B902084cB0FFECe40Da');

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

const UNISWAP_QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const UNISWAP_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
  'function multicall(bytes[] data) external payable returns (bytes[] memory results)'
];

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) external returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) external returns (uint[] amounts)'
];

/**
 * Inspects DEX liquidity for a non-Zora token across Uniswap V3 and Aerodrome on Base.
 */
async function findBestDexSellQuote(provider, tokenAddress, amountIn, targetAddress = WETH_BASE) {
  let best = { engine: null, amountOut: 0n, details: {} };
  let formattedTokenIn;
  let formattedTargetOut;

  try {
    formattedTokenIn = getAddress(tokenAddress);
    formattedTargetOut = getAddress(targetAddress);
  } catch (err) {
    return best;
  }

  // 1. Uniswap V3 Fee Tiers (0.01%, 0.05%, 0.3%, 1%)
  const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, UNISWAP_QUOTER_ABI, provider);
  const feeTiers = [100, 500, 3000, 10000];

  for (const fee of feeTiers) {
    try {
      const res = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: formattedTokenIn,
        tokenOut: formattedTargetOut,
        amountIn: BigInt(amountIn),
        fee,
        sqrtPriceLimitX96: 0n
      });
      if (res && res.amountOut && BigInt(res.amountOut) > best.amountOut) {
        best = {
          engine: 'UNISWAP_V3',
          amountOut: BigInt(res.amountOut),
          details: { fee, router: UNISWAP_V3_ROUTER }
        };
      }
    } catch (_) {}
  }

  // 2. Aerodrome Router (Volatile and Stable pools)
  const aero = new ethers.Contract(AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
  for (const stable of [false, true]) {
    try {
      const amounts = await aero.getAmountsOut(BigInt(amountIn), [
        { from: formattedTokenIn, to: formattedTargetOut, stable, factory: AERODROME_FACTORY }
      ]);
      if (amounts && amounts.length > 0) {
        const out = BigInt(amounts[amounts.length - 1]);
        if (out > best.amountOut) {
          best = {
            engine: 'AERODROME',
            amountOut: out,
            details: { stable, router: AERODROME_ROUTER }
          };
        }
      }
    } catch (_) {}
  }

  return best;
}

/**
 * Executes sell trade on DEX (Uniswap V3 or Aerodrome) for non-Zora tokens.
 */
async function executeDexSell({ provider, signerWallet, tokenAddress, amountIn, bestQuote, slippage = 0.05, targetAddress = WETH_BASE }) {
  if (!bestQuote || !bestQuote.engine || !bestQuote.amountOut || bestQuote.amountOut === 0n) {
    throw new Error(`TOKEN_HAS_NO_SELLABLE_LIQUIDITY: Token ${tokenAddress} has no active sellable liquidity pool on Uniswap V3 or Aerodrome.`);
  }

  const formattedToken = getAddress(tokenAddress);
  const formattedTarget = getAddress(targetAddress);
  const tokenContract = new ethers.Contract(formattedToken, ERC20_ABI, signerWallet);

  const routerAddress = bestQuote.details.router;

  // 1. Check and approve allowance
  const currentAllowance = await tokenContract.allowance(signerWallet.address, routerAddress).catch(() => 0n);
  if (BigInt(currentAllowance) < BigInt(amountIn)) {
    console.log(`[SellRouter] Approving ${formattedToken} for router ${routerAddress}...`);
    const approveTx = await tokenContract.approve(routerAddress, ethers.MaxUint256);
    await approveTx.wait();
  }

  // Calculate minimum expected output with slippage tolerance
  const slippageBps = BigInt(Math.floor((1 - slippage) * 10000));
  const amountOutMin = (bestQuote.amountOut * slippageBps) / 10000n;

  let txHash = null;
  let receivedAmount = amountOutMin;

  if (bestQuote.engine === 'UNISWAP_V3') {
    const uniRouter = new ethers.Contract(UNISWAP_V3_ROUTER, UNISWAP_ROUTER_ABI, signerWallet);

    if (formattedTarget === WETH_BASE) {
      // Execute multicall: exactInputSingle -> WETH, then unwrapWETH9 -> recipient
      const swapData = uniRouter.interface.encodeFunctionData('exactInputSingle', [{
        tokenIn: formattedToken,
        tokenOut: WETH_BASE,
        fee: bestQuote.details.fee,
        recipient: UNISWAP_V3_ROUTER,
        amountIn: BigInt(amountIn),
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
      }]);
      const unwrapData = uniRouter.interface.encodeFunctionData('unwrapWETH9', [
        amountOutMin,
        signerWallet.address
      ]);
      const tx = await uniRouter.multicall([swapData, unwrapData]);
      const receipt = await tx.wait();
      txHash = receipt.hash || tx.hash;
    } else {
      const tx = await uniRouter.exactInputSingle({
        tokenIn: formattedToken,
        tokenOut: formattedTarget,
        fee: bestQuote.details.fee,
        recipient: signerWallet.address,
        amountIn: BigInt(amountIn),
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
      });
      const receipt = await tx.wait();
      txHash = receipt.hash || tx.hash;
    }
  } else if (bestQuote.engine === 'AERODROME') {
    const aeroRouter = new ethers.Contract(AERODROME_ROUTER, AERODROME_ROUTER_ABI, signerWallet);
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const routes = [{
      from: formattedToken,
      to: formattedTarget,
      stable: bestQuote.details.stable,
      factory: AERODROME_FACTORY
    }];

    if (formattedTarget === WETH_BASE) {
      const tx = await aeroRouter.swapExactTokensForETH(
        BigInt(amountIn),
        amountOutMin,
        routes,
        signerWallet.address,
        deadline
      );
      const receipt = await tx.wait();
      txHash = receipt.hash || tx.hash;
    } else {
      const tx = await aeroRouter.swapExactTokensForTokens(
        BigInt(amountIn),
        amountOutMin,
        routes,
        signerWallet.address,
        deadline
      );
      const receipt = await tx.wait();
      txHash = receipt.hash || tx.hash;
    }
  }

  return {
    engine: bestQuote.engine,
    txHash,
    spent: BigInt(amountIn),
    received: receivedAmount
  };
}

module.exports = {
  WETH_BASE,
  USDC_BASE,
  findBestDexSellQuote,
  executeDexSell
};
