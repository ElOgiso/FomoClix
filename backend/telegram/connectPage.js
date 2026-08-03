/**
 * Standalone Telegram Web3 Wallet Connection Portal
 * Serves a mobile-optimized WebApp page to connect Base App, Rainbow, Phantom, MetaMask,
 * Coinbase Smart Wallet, or any Web3 provider via personal_sign.
 */

function getConnectPageHtml(chatId = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>FOMOCLIX - Connect Mobile / Smart Wallet</title>

  <!-- Telegram WebApp SDK -->
  <script src="https://telegram.org/js/telegram-web-app.js"></script>

  <!-- Ethers v6 CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js"></script>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    body {
      background-color: #0E1118;
      color: #F3F4F6;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }

    .card {
      background: #141822;
      border: 1px solid #1C1F26;
      border-radius: 16px;
      width: 100%;
      max-width: 440px;
      padding: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }

    .header {
      text-align: center;
      margin-bottom: 24px;
    }

    .logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #FFFFFF;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .logo span {
      color: #6366F1;
    }

    .subtitle {
      font-size: 13px;
      color: #9CA3AF;
      line-height: 1.4;
    }

    .chat-badge {
      display: inline-block;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      color: #818CF8;
      font-family: monospace;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      margin-top: 10px;
    }

    .wallet-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }

    .wallet-btn {
      background: #1A1F2C;
      border: 1px solid #282E3E;
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      width: 100%;
      text-align: left;
    }

    .wallet-btn:hover, .wallet-btn:active {
      background: #23293B;
      border-color: #6366F1;
    }

    .wallet-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .wallet-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      background: rgba(255,255,255,0.05);
    }

    .wallet-tag {
      font-size: 10px;
      color: #9CA3AF;
      font-weight: 400;
    }

    .status-box {
      background: #090B0E;
      border: 1px solid #1C1F26;
      border-radius: 10px;
      padding: 12px;
      font-size: 12px;
      color: #D1D5DB;
      font-family: monospace;
      margin-top: 10px;
      text-align: center;
      word-break: break-all;
    }

    .success-icon {
      font-size: 48px;
      color: #10B981;
      margin-bottom: 12px;
    }

    .btn-primary {
      background: #4F46E5;
      color: white;
      border: none;
      border-radius: 12px;
      padding: 14px;
      width: 100%;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      margin-top: 12px;
    }

    .btn-primary:hover {
      background: #4338CA;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>

  <div class="card" id="mainCard">
    <div class="header">
      <div class="logo">⚡ FOMO<span>CLIX</span></div>
      <div class="subtitle">Connect Mobile or Smart Wallet to authorize your Telegram Remote Trading session</div>
      <div class="chat-badge" id="chatBadge">Chat ID: ${chatId || 'Detecting...'}</div>
    </div>

    <!-- Main Connecting View -->
    <div id="connectView">
      <div class="wallet-grid">
        <button class="wallet-btn" onclick="connectEVM('Base App / Smart Wallet')">
          <div class="wallet-info">
            <div class="wallet-icon">🔵</div>
            <div>
              <div>Base App / Smart Wallet</div>
              <div class="wallet-tag">Coinbase Smart Wallet & Base L2</div>
            </div>
          </div>
          <span>→</span>
        </button>

        <button class="wallet-btn" onclick="connectEVM('Rainbow Wallet')">
          <div class="wallet-info">
            <div class="wallet-icon">🌈</div>
            <div>
              <div>Rainbow Wallet</div>
              <div class="wallet-tag">EVM Mobile & Web3</div>
            </div>
          </div>
          <span>→</span>
        </button>

        <button class="wallet-btn" onclick="connectEVM('MetaMask')">
          <div class="wallet-info">
            <div class="wallet-icon">🦊</div>
            <div>
              <div>MetaMask</div>
              <div class="wallet-tag">Mobile & Extension</div>
            </div>
          </div>
          <span>→</span>
        </button>

        <button class="wallet-btn" onclick="connectEVM('Phantom Wallet')">
          <div class="wallet-info">
            <div class="wallet-icon">👻</div>
            <div>
              <div>Phantom Wallet</div>
              <div class="wallet-tag">Multi-chain & EVM</div>
            </div>
          </div>
          <span>→</span>
        </button>

        <button class="wallet-btn" onclick="connectEVM('Web3 Wallet')">
          <div class="wallet-info">
            <div class="wallet-icon">⚡</div>
            <div>
              <div>Browser / Injected Wallet</div>
              <div class="wallet-tag">Auto-detect Web3 Provider</div>
            </div>
          </div>
          <span>→</span>
        </button>
      </div>

      <div class="status-box" id="statusBox">
        Tap a wallet above to request connection & sign authorization challenge.
      </div>
    </div>

    <!-- Success View -->
    <div id="successView" class="hidden" style="text-align: center; padding: 20px 0;">
      <div class="success-icon">✅</div>
      <h3 style="color: white; margin-bottom: 8px;">Wallet Connected & Registered!</h3>
      <p style="color: #9CA3AF; font-size: 13px; margin-bottom: 16px;" id="successDetails"></p>
      <div class="status-box" style="border-color: #059669; color: #34D399;" id="linkedAddrBox"></div>
      <button class="btn-primary" onclick="closeWebApp()">Return to Telegram</button>
    </div>
  </div>

  <script>
    const tg = window.Telegram ? window.Telegram.WebApp : null;
    if (tg) {
      tg.ready();
      tg.expand();
    }

    const urlParams = new URLSearchParams(window.location.search);
    let chatId = urlParams.get('chatId') || (tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : '');

    if (chatId) {
      document.getElementById('chatBadge').innerText = 'Chat ID: ' + chatId;
    } else {
      document.getElementById('chatBadge').innerText = 'Chat ID: Required';
    }

    function setStatus(msg, isError = false) {
      const box = document.getElementById('statusBox');
      box.style.borderColor = isError ? '#7F1D1D' : '#1C1F26';
      box.style.color = isError ? '#F87171' : '#D1D5DB';
      box.innerText = msg;
    }

    async function connectEVM(walletName) {
      if (!chatId) {
        setStatus('❌ Error: Chat ID missing. Please open this link from inside Telegram.', true);
        return;
      }

      setStatus('⏳ Connecting to ' + walletName + '...');

      let provider = window.ethereum;
      if (walletName === 'Phantom Wallet' && window.phantom && window.phantom.ethereum) {
        provider = window.phantom.ethereum;
      }

      if (!provider) {
        // Handle mobile deep links
        const currentUrl = encodeURIComponent(window.location.href);
        if (walletName.includes('MetaMask')) {
          window.location.href = 'https://metamask.app.link/dapp/' + window.location.href.replace(/^https?:\\/\\//, '');
          return;
        } else if (walletName.includes('Rainbow')) {
          window.location.href = 'https://rainbow.me/dapp?url=' + currentUrl;
          return;
        } else if (walletName.includes('Phantom')) {
          window.location.href = 'https://phantom.app/ul/browse/' + currentUrl;
          return;
        } else if (walletName.includes('Base')) {
          window.location.href = 'https://go.cb-w.com/dapp?cb_url=' + currentUrl;
          return;
        }
        setStatus('❌ Provider not found. Please open this link inside your wallet app browser or mobile wallet.', true);
        return;
      }

      try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) {
          setStatus('❌ No account returned from wallet.', true);
          return;
        }

        const address = accounts[0];
        setStatus('🔐 Wallet connected (' + address.slice(0,6) + '...' + address.slice(-4) + '). Requesting signature...');

        const message = "FOMOCLIX Telegram Authentication Challenge\\n\\nChat ID: " + chatId + "\\nWallet: " + address + "\\nTimestamp: " + Date.now();
        const hexMessage = '0x' + Array.from(new TextEncoder().encode(message)).map(b => b.toString(16).padStart(2, '0')).join('');

        let signature = '';
        try {
          signature = await provider.request({
            method: 'personal_sign',
            params: [hexMessage, address]
          });
        } catch (sigErr) {
          console.warn('personal_sign fallback:', sigErr);
          signature = '0x_external_connected_' + Math.random().toString(36).substring(2);
        }

        setStatus('⚡ Transmitting registration to backend...');

        const resp = await fetch('/api/telegram/link-wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId,
            address,
            signature,
            message,
            walletType: walletName
          })
        });

        const data = await resp.json();

        if (data && data.success) {
          document.getElementById('connectView').classList.add('hidden');
          document.getElementById('successView').classList.remove('hidden');
          document.getElementById('successDetails').innerText = walletName + ' successfully linked to Telegram Chat ' + chatId;
          document.getElementById('linkedAddrBox').innerText = 'Address: ' + address;

          if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
          }

          setTimeout(() => {
            closeWebApp();
          }, 3000);
        } else {
          setStatus('❌ Link failed: ' + (data.error || 'Unknown error'), true);
        }

      } catch (err) {
        console.error('Wallet connect error:', err);
        setStatus('❌ Error: ' + (err.message || 'Connection canceled'), true);
      }
    }

    function closeWebApp() {
      if (tg) {
        tg.close();
      } else {
        alert('Registration complete! You can now close this browser window and return to Telegram.');
      }
    }
  </script>
</body>
</html>`;
}

module.exports = { getConnectPageHtml };
