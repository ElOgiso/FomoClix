import React from 'react';

export const RiskContent = () => (
  <>
    {/* ── RISK DISCLOSURE ── */}
    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">Risk Disclosure Statement</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Trading cryptocurrencies and digital assets involves substantial risk of loss and is not appropriate for all investors. Before using the FOMOCLIX automated trading bot, you must carefully read, understand, and accept the following risks. This disclosure does not constitute financial advice.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">1. Market Risk</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Cryptocurrency markets are highly speculative and subject to extreme price volatility. Token values can decline rapidly and without warning due to macroeconomic events, regulatory announcements, exchange failures, or shifts in market sentiment. You may lose some or all of your invested capital. FOMOCLIX provides no guarantee of returns or protection against market downturns.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">2. Automated Trading Risk</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Automated trading systems, including FOMOCLIX, operate based on pre-programmed algorithms and market signals. These systems may execute trades under adverse market conditions, including but not limited to flash crashes, sudden liquidity crunches, or periods of extreme volatility. Algorithm errors, bugs, or unexpected behavior in response to novel market conditions may result in unintended trades or financial losses. Historical backtesting results do not guarantee future performance.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">3. Smart Contract Risk</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX interacts with third-party decentralized exchange (DEX) smart contracts. These contracts may contain vulnerabilities, bugs, or exploits. Smart contract code is immutable once deployed; errors cannot be corrected after deployment. Funds interacting with smart contracts are at risk of loss due to protocol hacks, rug pulls, or contract exploits beyond FOMOCLIX's control. You should only risk capital you can afford to lose entirely.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">4. Liquidity Risk</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Many tokens traded by the bot, particularly newly launched or low-cap tokens, may have insufficient liquidity. This can result in significant slippage between quoted and executed prices, inability to exit positions, or substantial price impact when executing large orders. High slippage may substantially reduce or eliminate realized profits.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">5. Regulatory Risk</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      The regulatory landscape for cryptocurrencies and automated trading tools is rapidly evolving and varies across jurisdictions. New laws or enforcement actions may restrict or prohibit the use of services like FOMOCLIX in certain regions. Regulatory changes could adversely affect the value of digital assets or require us to discontinue the Service in certain markets without prior notice.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">6. No Guarantees</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX makes no representations or warranties regarding the profitability of any trading strategy. No statement on our platform, in our marketing materials, or from our team constitutes a promise of profit. Any forward-looking statements about expected returns are speculative and subject to material uncertainty. You trade entirely at your own risk.
    </p>

    {/* ── AML NOTICE ── */}
    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">Anti-Money Laundering (AML) Notice</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX is committed to preventing the use of our platform for money laundering, terrorist financing, or any other illicit financial activity. By using our Service, you agree to comply with all applicable AML regulations.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">7. AML Policy</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX maintains an internal AML compliance program consistent with industry best practices for decentralized finance platforms. We monitor for suspicious transaction patterns, including unusually large or rapid fund movements, structuring behavior, and interaction with flagged wallet addresses. We reserve the right to restrict, suspend, or terminate any account that triggers AML controls without prior notice or obligation to disclose our reasons.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">8. Source of Funds</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      By connecting your wallet and using FOMOCLIX, you represent and warrant that all digital assets you deploy through the Service are derived from legitimate sources and are not the proceeds of any criminal, fraudulent, or otherwise unlawful activity. You agree to provide documentation evidencing the lawful origin of your funds upon request to the extent required by applicable law or at our reasonable discretion.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">9. Prohibited Jurisdictions</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      FOMOCLIX does not provide services to individuals or entities located in, or ordinarily resident in, countries or territories subject to comprehensive sanctions programs, including but not limited to:
    </p>
    <ul className="list-disc list-inside text-gray-400 text-[8px] leading-relaxed mb-2 space-y-0.5">
      <li>Cuba, Iran, North Korea, Russia, Syria, and the Crimea/Donetsk/Luhansk regions of Ukraine (per OFAC SDN list).</li>
      <li>Any jurisdiction designated by the Financial Action Task Force (FATF) as high-risk or non-cooperative.</li>
      <li>Any country subject to a comprehensive embargo administered by the EU, UK, or UN Security Council.</li>
      <li>The United States of America and its territories for regulatory compliance purposes.</li>
    </ul>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      Use of VPNs, proxies, or other tools to circumvent geographic restrictions is a material breach of our Terms of Service and may result in immediate account termination and reporting to relevant authorities.
    </p>

    <h3 className="text-indigo-400 font-bold text-[9px] uppercase tracking-wider mb-1.5">10. Reporting</h3>
    <p className="text-gray-400 text-[8px] leading-relaxed mb-2">
      To the extent required by applicable law, FOMOCLIX may report suspicious activity to relevant financial intelligence units or law enforcement authorities. We cooperate fully with legitimate legal processes, including subpoenas and court orders, and will disclose user information as required. To report suspected AML violations or financial crime, contact us at <span className="text-indigo-400">compliance@fomoclix.com</span>.
    </p>
  </>
);
