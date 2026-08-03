import React from 'react';

export const PrivacyContent = () => (
  <>
    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">1. Introduction</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and the choices you have regarding your personal data when you use the FOMOCLIX automated trading platform. By using our Service, you consent to the practices described herein. This policy is incorporated into and subject to our Terms of Service.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">2. Data We Collect</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">We collect the following categories of information:</p>
    <ul className="list-disc list-inside text-gray-400 text-[8px] leading-relaxed mb-2 space-y-0.5">
      <li><strong className="text-gray-300">Wallet Address:</strong> Your public blockchain wallet address(es) used to authenticate and interact with the Service. This is a public identifier on the blockchain.</li>
      <li><strong className="text-gray-300">Trading History:</strong> Records of all trades executed by the bot on your behalf, including token pairs, amounts, timestamps, transaction hashes, and profit/loss data.</li>
      <li><strong className="text-gray-300">AI Chat Logs:</strong> Conversations you initiate with our AI assistant, including prompts, responses, and strategy queries, which are stored to improve model quality and provide continuity of service.</li>
      <li><strong className="text-gray-300">Device &amp; Usage Data:</strong> Browser type, IP address (anonymized after 30 days), pages visited, feature interactions, and session duration, collected via standard server logs and analytics.</li>
      <li><strong className="text-gray-300">Onboarding Acknowledgments:</strong> Records of your agreement to these terms, timestamps, and selected subscription plan.</li>
    </ul>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">3. How We Use Your Data</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">We process your data for the following purposes:</p>
    <ul className="list-disc list-inside text-gray-400 text-[8px] leading-relaxed mb-2 space-y-0.5">
      <li>To operate, maintain, and improve the automated trading bot and associated features.</li>
      <li>To calculate and apply performance fees on profitable trades under the PAYG plan.</li>
      <li>To display your portfolio performance, trade history, and analytics within the dashboard.</li>
      <li>To provide AI-powered trading insights and respond to in-app chat queries.</li>
      <li>To detect, prevent, and investigate fraud, abuse, or violations of our Terms of Service.</li>
      <li>To comply with applicable legal obligations, including anti-money laundering (AML) regulations.</li>
      <li>To send service-critical communications (e.g., bot status alerts, fee change notices).</li>
    </ul>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">4. Data Storage &amp; Security</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Your data is stored in <strong className="text-gray-300">Google Firebase and Firestore</strong> hosted on Google Cloud Platform (GCP) infrastructure. Firebase employs industry-standard encryption at rest (AES-256) and in transit (TLS 1.2+). Access to production databases is restricted to authorized personnel via role-based access controls and multi-factor authentication. We conduct periodic security reviews and vulnerability assessments to maintain data integrity.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">5. Third-Party Services</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">We integrate with the following third-party providers, each subject to their own privacy policies:</p>
    <ul className="list-disc list-inside text-gray-400 text-[8px] leading-relaxed mb-2 space-y-0.5">
      <li><strong className="text-gray-300">Alchemy:</strong> Blockchain node infrastructure used to query on-chain data and broadcast transactions. May receive your wallet address and transaction parameters.</li>
      <li><strong className="text-gray-300">Neynar:</strong> Farcaster social graph API used to analyze social signals and trending tokens. May receive wallet address and query parameters.</li>
      <li><strong className="text-gray-300">CoinGecko:</strong> Market data provider supplying token prices, volumes, and market capitalization data. Requests are made server-side; no personal data is shared.</li>
      <li><strong className="text-gray-300">Google Gemini (AI Studio):</strong> Large language model API powering our AI chat assistant. Chat messages are transmitted to Google's servers; please review Google's AI data usage policies at ai.google.dev.</li>
    </ul>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">6. Data Retention</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      We retain your data for as long as your account is active or as needed to provide the Service. Trading history and fee records are retained for a minimum of 5 years to comply with financial recordkeeping obligations. AI chat logs are retained for 12 months, after which they are automatically deleted or anonymized. You may request earlier deletion subject to our legal obligations (see Section 7). IP address logs are anonymized within 30 days of collection.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">7. Your Rights</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Depending on your jurisdiction, you may have the right to access, correct, delete, or export your personal data. You may also object to or restrict certain processing activities. To exercise these rights, contact us at <span className="text-indigo-400">privacy@fomoclix.com</span>. We will respond within 30 days. Note that some data may be retained to fulfill legal obligations even after an account deletion request.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">8. Cookies &amp; Tracking</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX uses strictly necessary cookies and local storage to maintain your authenticated session and preserve user preferences. We do not use third-party advertising cookies or behavioral tracking cookies. Analytics data (if any) is collected in an aggregated, anonymized form. You may clear browser storage at any time, which will require you to re-authenticate.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">9. Contact</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      For privacy-related inquiries, please contact our Data Protection contact at <span className="text-indigo-400">privacy@fomoclix.com</span>. FOMOCLIX Labs, registered in Delaware. This Privacy Policy was last updated on July 1, 2025.
    </p>
  </>
);
