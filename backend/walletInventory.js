/**
 * Dedicated Wallet Inventory Module
 * Independent from Active Trades, Position Manager, and Trading History.
 * Performs deep multi-source scans of every asset in the configured trading wallet.
 * Reuses existing backend execution, private keys, and RPC configuration.
 * Multi-scanner architecture:
 * 1. Backend Tracked Trading Positions & History
 * 2. Official Zora Profile Balances API (getProfileBalances / getProfileCoins / getProfile) with full pagination loop
 * 3. On-chain ERC-20 Token Balance Indexer on Base (Alchemy token balances RPC + onchain contract calls)
 */

const { ethers } = require('ethers');
const { classifyInventory } = require('./walletClassifier');

function safeEtherToFloat(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'bigint') {
    try {
      return parseFloat(ethers.formatEther(val));
    } catch (_) {
      return 0;
    }
  }
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  const str = String(val).trim();
  if (!str || str === 'n/a' || str === 'N/A') return 0;
  if (str.includes('.')) {
    return parseFloat(str) || 0;
  }
  try {
    return parseFloat(ethers.formatEther(BigInt(str)));
  } catch (_) {
    return parseFloat(str) || 0;
  }
}

class WalletInventoryScanner {
  /**
   * Main scan entry point. Merges ERC20 Scanner, Zora Profile Balances API, & Backend Positions.
   */
  static async scanInventory(options = {}) {
    const {
      targetIdentifier = null,
      ethersProvider = null,
      ethersWallet = null,
      db = null,
      ethPriceUsd = 0,
      ZORA_READ_API_KEY = '',
      USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      rateLimitedZoraCall = null,
      getCoin = null,
      getCoins = null,
      getProfileCoins = null,
      getProfileBalances = null,
      getProfile = null
    } = options;

    try {
      let targetAddress = ethersWallet ? ethersWallet.address : '';
      let targetUid = null;
      const val = String(targetIdentifier || '');

      if (val.startsWith('0x')) {
        targetAddress = val;
      } else if (val && val !== 'null' && val !== 'undefined') {
        targetUid = val;
        try {
          const { loadTradingWallet } = require('./routes/onboarding');
          const loaded = await loadTradingWallet(targetUid, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          if (loaded && loaded.address) {
            targetAddress = loaded.address;
          }
        } catch (_) {}
      }

      if (!targetAddress) {
        targetAddress = '0x0000000000000000000000000000000000000000';
      }

      // 1. Fetch native gas balance & USDC balance
      let ethBalanceWei = 0n;
      let usdcBalanceWei = 0n;

      if (ethersProvider && targetAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          ethBalanceWei = await ethersProvider.getBalance(targetAddress).catch(() => 0n);
          if (USDC_ADDRESS) {
            const usdcContract = new ethers.Contract(
              USDC_ADDRESS,
              ['function balanceOf(address) view returns (uint256)'],
              ethersProvider
            );
            usdcBalanceWei = await usdcContract.balanceOf(targetAddress).catch(() => 0n);
          }
        } catch (err) {
          console.warn('[WalletInventoryScanner] Failed fetching native balance:', err.message);
        }
      }

      const ethBalance = parseFloat(ethers.formatEther(ethBalanceWei));
      const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceWei, 6));
      const ethValUsd = ethBalance * ethPriceUsd;
      const nativeTotalUsd = ethValUsd + usdcBalance;

      // Master item map keyed by lowercase address
      const itemsMap = new Map();

      // Native Asset Entry
      const ethItem = WalletInventoryScanner.buildItemFormat({
        name: 'Base ETH (Gas)',
        symbol: 'ETH',
        contract: 'N/A',
        coinType: 'Native Gas',
        rawBalance: ethBalanceWei.toString(),
        humanBalance: ethBalance.toFixed(4),
        balance: ethBalance.toFixed(4),
        usdValue: ethValUsd,
        price: ethPriceUsd,
        liquidity: 'Native Gas Asset',
        liquidityStatus: 'Active',
        sellable: false,
        reasonIfNotSellable: 'Native gas currency cannot be sold directly',
        image: null,
        creator: 'Base L2 Network',
        marketCap: 'N/A',
        poolAddress: 'N/A',
        chain: 'base',
        category: 'Native Gas',
        dexAvailability: 'Native Gas'
      });
      itemsMap.set('ETH', ethItem);

      if (usdcBalanceWei > 0n) {
        const usdcItem = WalletInventoryScanner.buildItemFormat({
          name: 'USD Coin',
          symbol: 'USDC',
          contract: USDC_ADDRESS.toLowerCase(),
          coinType: 'Stablecoin',
          rawBalance: usdcBalanceWei.toString(),
          humanBalance: usdcBalance.toFixed(2),
          balance: usdcBalance.toFixed(2),
          usdValue: usdcBalance,
          price: 1.00,
          liquidity: 'High ($100M+)',
          liquidityStatus: 'Active',
          sellable: true,
          reasonIfNotSellable: null,
          image: null,
          creator: 'Circle',
          marketCap: '$30B+',
          poolAddress: '0xd0b53D9277642d139eA9d6544499b6308548c7c7',
          chain: 'base',
          category: 'Stablecoin',
          dexAvailability: 'Uniswap V3 / Aerodrome'
        });
        itemsMap.set(USDC_ADDRESS.toLowerCase(), usdcItem);
      }

      // --- SOURCE 1 & 3: Scan candidates from DB trades, active positions, & Alchemy Token Indexer ---
      const erc20CandidateAddresses = new Set();
      if (db) {
        try {
          const tradesSnap = await db.collection('trades').limit(200).get();
          tradesSnap.docs.forEach(doc => {
            const d = doc.data();
            if (d.tokenAddress && d.tokenAddress.startsWith('0x')) {
              erc20CandidateAddresses.add(d.tokenAddress.toLowerCase());
            }
          });
        } catch (dbErr) {
          console.warn('[WalletInventoryScanner] DB query warning:', dbErr.message);
        }
      }

      // Alchemy Token Balance Indexer on Base (with full pageKey pagination to discover 100% of wallet ERC-20 tokens)
      const alchemyRpcUrl = process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL;
      if (alchemyRpcUrl && targetAddress && targetAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : require('node-fetch').default;
          let pageKey = null;
          let alchemyPages = 0;
          do {
            alchemyPages++;
            const requestParams = pageKey ? [targetAddress, 'erc20', { pageKey }] : [targetAddress, 'erc20'];
            const alchemyRes = await fetchFn(alchemyRpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'alchemy_getTokenBalances',
                params: requestParams
              })
            }).then(r => r.json()).catch(() => null);

            if (alchemyRes?.result?.tokenBalances) {
              for (const tb of alchemyRes.result.tokenBalances) {
                if (tb.contractAddress && tb.tokenBalance) {
                  try {
                    const bal = BigInt(tb.tokenBalance);
                    if (bal > 0n) {
                      erc20CandidateAddresses.add(tb.contractAddress.toLowerCase());
                    }
                  } catch (_) {}
                }
              }
            }
            pageKey = alchemyRes?.result?.pageKey || null;
          } while (pageKey && alchemyPages < 20);
        } catch (alchemyErr) {
          console.warn('[WalletInventoryScanner] Alchemy token balance indexing error:', alchemyErr.message);
        }
      }

      // Process candidates from Source 1 & 3
      for (const coinAddr of erc20CandidateAddresses) {
        if (coinAddr === USDC_ADDRESS.toLowerCase()) continue;
        if (!ethers.isAddress(coinAddr)) continue;

        let tokenBalanceWei = 0n;
        let decimals = 18;
        let symbol = 'TOKEN';
        let name = 'Onchain Token';

        if (ethersProvider && targetAddress !== '0x0000000000000000000000000000000000000000') {
          try {
            const tokenContract = new ethers.Contract(
              coinAddr,
              [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)',
                'function symbol() view returns (string)',
                'function name() view returns (string)'
              ],
              ethersProvider
            );

            const [bal, dec, sym, nme] = await Promise.all([
              tokenContract.balanceOf(targetAddress).catch(() => 0n),
              tokenContract.decimals().catch(() => 18),
              tokenContract.symbol().catch(() => 'TOKEN'),
              tokenContract.name().catch(() => 'Onchain Token')
            ]);

            tokenBalanceWei = bal;
            decimals = dec;
            symbol = sym;
            name = nme;
          } catch (_) {}
        }

        if (tokenBalanceWei === 0n) continue;

        const humanBal = parseFloat(ethers.formatUnits(tokenBalanceWei, decimals));
        let volume24hEth = 0;
        let liquidityStatus = 'Active';
        let isSellable = true;
        let reasonIfNotSellable = null;
        let priceEth = 0.00001;
        let creatorAddress = 'Unknown';
        let creatorProfile = null;
        let image = null;

        if (rateLimitedZoraCall && getCoin) {
          try {
            const coinData = await rateLimitedZoraCall(() => getCoin({ address: coinAddr, chain: 8453, apiKey: ZORA_READ_API_KEY })).catch(() => null);
            if (coinData?.data?.zora20Token) {
              const zt = coinData.data.zora20Token;
              creatorAddress = zt.creatorAddress || 'Unknown';
              creatorProfile = zt.creatorProfile || null;
              image = zt.mediaContent?.previewImage?.medium || zt.creatorProfile?.avatar?.previewImage?.small || null;
              if (zt.volume24h) {
                volume24hEth = safeEtherToFloat(zt.volume24h);
              }
              if (zt.marketCap) {
                priceEth = safeEtherToFloat(zt.marketCap) / 1e9;
              }
            }
          } catch (_) {}
        }

        const usdVal = humanBal * priceEth * ethPriceUsd;

        if (volume24hEth === 0 && usdVal < 0.10) {
          liquidityStatus = 'Low Volatility';
        }

        let category = 'ERC20 Token';
        if (volume24hEth === 0 && usdVal < 0.10) {
          category = 'Dead Liquidity';
        } else if (usdVal < 0.50) {
          category = 'Dust';
        }

        const erc20Item = WalletInventoryScanner.buildItemFormat({
          name,
          symbol,
          contract: coinAddr,
          coinType: 'ERC20',
          rawBalance: tokenBalanceWei.toString(),
          humanBalance: humanBal.toLocaleString('en-US', { maximumFractionDigits: 4 }),
          balance: humanBal.toLocaleString('en-US', { maximumFractionDigits: 4 }),
          usdValue: usdVal,
          price: priceEth * ethPriceUsd,
          liquidity: volume24hEth > 0 ? `$${(volume24hEth * ethPriceUsd).toFixed(0)} 24h Vol` : 'Low Volatility',
          liquidityStatus,
          sellable: true,
          reasonIfNotSellable: null,
          image,
          creator: creatorAddress,
          creatorProfile,
          marketCap: `$${(priceEth * 1e9 * ethPriceUsd).toFixed(0)}`,
          poolAddress: 'Uniswap V3 Pool',
          chain: 'base',
          category,
          dexAvailability: 'Uniswap V3 / Aerodrome (Base L2)'
        });

        itemsMap.set(coinAddr, erc20Item);
      }

      // --- SOURCE 2: Official Zora Profile Balances API (getProfileBalances / getProfileCoins / getProfile) with FULL PAGINATION ---
      if (rateLimitedZoraCall && (getProfileBalances || getProfileCoins || getProfile)) {
        try {
          const profileFunc = getProfileBalances || getProfileCoins || getProfile;
          let hasNextPage = true;
          let afterCursor = null;
          let pageCount = 0;
          const maxPages = 20;

          while (hasNextPage && pageCount < maxPages) {
            pageCount++;
            const queryParams = {
              identifier: targetAddress,
              chainIds: [8453],
              count: 50,
              apiKey: ZORA_READ_API_KEY
            };
            if (afterCursor) {
              queryParams.after = afterCursor;
            }

            const zoraRawData = await rateLimitedZoraCall(() => profileFunc(queryParams)).catch(() => null);
            if (!zoraRawData) {
              hasNextPage = false;
              break;
            }

            const profileObj = zoraRawData?.data?.profile || zoraRawData?.data?.zoraProfile || zoraRawData?.data?.profileBalances || null;
            const coinBalances = zoraRawData?.data?.profileBalances || profileObj?.coinBalances || profileObj?.coins || profileObj?.createdCoins || null;
            const coinEdges = coinBalances?.edges || zoraRawData?.data?.coinBalances?.edges || profileObj?.edges || [];

            for (const edge of coinEdges) {
              const coin = edge.node || edge.coin || edge;
              const coinAddr = (coin.address || coin.contractAddress || coin.tokenAddress || '').toLowerCase();
              if (!coinAddr || coinAddr === 'n/a') continue;

              let coinType = 'Creator Coin';
              const sdkType = (coin.coinType || coin.version || '').toString();
              if (sdkType.includes('Content') || sdkType.includes('Media')) {
                coinType = 'Content Coin';
              } else if (sdkType.includes('Trend') || coin.isTrending) {
                coinType = 'Trend Coin';
              } else if (sdkType.includes('LP') || (coin.name && coin.name.includes('LP'))) {
                coinType = 'LP';
              }

              let tokenBalanceWei = 0n;
              if (ethersProvider && ethers.isAddress(coinAddr)) {
                tokenBalanceWei = await new ethers.Contract(
                  coinAddr,
                  ['function balanceOf(address) view returns (uint256)'],
                  ethersProvider
                ).balanceOf(targetAddress).catch(() => 0n);
              }

              let rawBalStr = '0';
              if (tokenBalanceWei > 0n) {
                rawBalStr = tokenBalanceWei.toString();
              } else if (coin.balance !== undefined && coin.balance !== null) {
                rawBalStr = String(coin.balance);
              } else {
                rawBalStr = '0';
              }

              const humanBal = tokenBalanceWei > 0n
                ? safeEtherToFloat(tokenBalanceWei)
                : safeEtherToFloat(rawBalStr);

              const volEth = coin.volume24h ? safeEtherToFloat(coin.volume24h) : 0;
              const mCapEth = coin.marketCap ? safeEtherToFloat(coin.marketCap) : 0.01;
              
              let priceEth = 0;
              if (coin.tokenPriceEth || coin.priceEth || coin.priceInEth || coin.price) {
                priceEth = safeEtherToFloat(coin.tokenPriceEth || coin.priceEth || coin.priceInEth || coin.price);
              } else if (coin.tokenPriceUsd || coin.priceUsd) {
                priceEth = safeEtherToFloat(coin.tokenPriceUsd || coin.priceUsd) / (ethPriceUsd || 3000);
              } else if (coin.totalSupply && mCapEth > 0) {
                const supply = safeEtherToFloat(coin.totalSupply);
                priceEth = supply > 0 ? mCapEth / supply : mCapEth / 1e9;
              } else {
                priceEth = mCapEth / 1e9;
              }

              const usdVal = humanBal * priceEth * ethPriceUsd;

              let isSellable = true;
              let reasonIfNotSellable = null;

              if (coinType === 'LP') {
                isSellable = false;
                reasonIfNotSellable = 'Sell not supported for LP position yet';
              }

              const zoraItem = WalletInventoryScanner.buildItemFormat({
                name: coin.name || 'Zora Onchain Coin',
                symbol: coin.symbol || 'ZORA',
                contract: coinAddr,
                coinType,
                rawBalance: rawBalStr,
                humanBalance: humanBal.toLocaleString('en-US', { maximumFractionDigits: 4 }),
                balance: humanBal.toLocaleString('en-US', { maximumFractionDigits: 4 }),
                usdValue: usdVal,
                price: priceEth * ethPriceUsd,
                liquidity: volEth > 0 ? `$${(volEth * ethPriceUsd).toFixed(0)} 24h Vol` : 'Zora Protocol Liquidity',
                liquidityStatus: isSellable ? 'Active' : 'Low Volatility / Dead Liquidity',
                sellable: isSellable,
                reasonIfNotSellable,
                image: coin.mediaContent?.previewImage?.medium || coin.creatorProfile?.avatar?.previewImage?.small || null,
                creator: coin.creatorAddress || coin.creatorProfile?.handle || targetAddress,
                creatorProfile: coin.creatorProfile || null,
                marketCap: `$${(mCapEth * ethPriceUsd).toFixed(0)}`,
                holders: coin.holdersCount || coin.holders || 'N/A',
                poolAddress: coin.poolAddress || 'Zora Uniswap V3 Pool',
                chain: 'base',
                category: coinType,
                dexAvailability: 'Zora Protocol / Base L2'
              });

              // Deduplicate: merge or insert
              if (itemsMap.has(coinAddr)) {
                const existing = itemsMap.get(coinAddr);
                itemsMap.set(coinAddr, {
                  ...existing,
                  coinType: zoraItem.coinType || existing.coinType,
                  image: zoraItem.image || existing.image,
                  creator: zoraItem.creator !== targetAddress ? zoraItem.creator : existing.creator,
                  creatorProfile: zoraItem.creatorProfile || existing.creatorProfile,
                  marketCap: zoraItem.marketCap !== '$35' ? zoraItem.marketCap : existing.marketCap,
                  holders: zoraItem.holders !== 'N/A' ? zoraItem.holders : existing.holders,
                  poolAddress: zoraItem.poolAddress !== 'N/A' ? zoraItem.poolAddress : existing.poolAddress,
                  category: zoraItem.category || existing.category
                });
              } else {
                itemsMap.set(coinAddr, zoraItem);
              }
            }

            const pageInfo = coinBalances?.pageInfo || profileObj?.pageInfo || zoraRawData?.data?.pageInfo || null;
            if (pageInfo && pageInfo.hasNextPage && pageInfo.endCursor && pageInfo.endCursor !== afterCursor) {
              afterCursor = pageInfo.endCursor;
            } else {
              hasNextPage = false;
            }
          }
        } catch (zoraErr) {
          console.warn('[WalletInventoryScanner] Zora wallet scan error:', zoraErr.message);
        }
      }

      const allItems = Array.from(itemsMap.values());
      const totalTokenUsd = allItems.reduce((acc, item) => acc + (item.usdValue || 0), 0);
      const grandTotalPortfolioValue = (nativeTotalUsd + totalTokenUsd).toFixed(2);

      const rawResult = {
        success: true,
        walletAddress: targetAddress,
        totalInventoryValue: grandTotalPortfolioValue,
        totalWalletBalance: `${ethBalance.toFixed(4)} ETH / ${usdcBalance.toFixed(2)} USDC`,
        totalTokensCount: allItems.length,
        items: allItems,
        timestamp: Date.now()
      };

      const classified = classifyInventory(rawResult);

      return {
        ...rawResult,
        ...classified
      };
    } catch (err) {
      console.error('[WalletInventoryScanner Error]', err);
      return {
        success: false,
        walletAddress: 'N/A',
        totalInventoryValue: '0.00',
        totalWalletBalance: '0 ETH',
        totalTokensCount: 0,
        sellableCount: 0,
        unsellableCount: 0,
        items: [],
        error: err.message
      };
    }
  }

  /**
   * Helper to build standardized complete inventory item format
   */
  static buildItemFormat(data) {
    const isSellable = Boolean(data.sellable);
    return {
      name: data.name || 'Onchain Asset',
      symbol: data.symbol || 'TOKEN',
      contract: data.contract || data.address || 'N/A',
      address: data.contract || data.address || 'N/A',
      coinType: data.coinType || 'ERC20',
      balance: data.balance || data.humanBalance || '0',
      humanBalance: data.humanBalance || data.balance || '0',
      rawBalance: data.rawBalance || '0',
      usdValue: typeof data.usdValue === 'number' ? data.usdValue : 0,
      price: typeof data.price === 'number' ? data.price : 0,
      liquidity: data.liquidity || 'Onchain Liquidity',
      liquidityStatus: data.liquidityStatus || 'Active',
      sellable: isSellable,
      reasonIfNotSellable: isSellable ? null : (data.reasonIfNotSellable || 'Sell not supported for this asset type yet'),
      image: data.image || null,
      creator: data.creator || 'Unknown',
      creatorProfile: data.creatorProfile || null,
      marketCap: data.marketCap || 'N/A',
      holders: data.holders || 'N/A',
      poolAddress: data.poolAddress || 'N/A',
      chain: data.chain || 'base',
      lastUpdated: Date.now(),
      category: data.category || data.coinType || 'Onchain Asset',
      dexAvailability: data.dexAvailability || 'Base L2 / Onchain'
    };
  }

  /**
   * Execute Sell All Sellable using existing backend execution function
   */
  static async executeSellAllSellable(backendServices, userIdOrWallet) {
    if (!backendServices || typeof backendServices.executeSellAll !== 'function') {
      return { succeeded: [], failed: [], skipped: [], unsellable: [] };
    }
    return await backendServices.executeSellAll({ userIdOrWallet });
  }

  /**
   * Execute Sell Selected using existing backend execution function
   */
  static async executeSellSelected(backendServices, tokenAddresses, userIdOrWallet) {
    if (!backendServices || typeof backendServices.executeSellSelected !== 'function') {
      return { succeeded: [], failed: [], skipped: [], unsellable: [] };
    }
    return await backendServices.executeSellSelected({ tokenAddresses, userIdOrWallet });
  }
}

module.exports = { WalletInventoryScanner };
