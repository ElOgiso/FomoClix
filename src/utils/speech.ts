/**
 * Shared Speech Synthesis Utilities
 * Uses the exact same default female voice logic as the AI Orchestrator Chat
 */

export const getFemaleVoice = (): SpeechSynthesisVoice | null => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => {
    const nameLower = v.name.toLowerCase();
    const matchesPattern = (
      nameLower.includes('google us english') ||
      nameLower.includes('google uk english female') ||
      nameLower.includes('samantha') ||
      nameLower.includes('female') ||
      nameLower.includes('natural')
    );
    const isRobotic = nameLower.includes('zira') || nameLower.includes('hazel') || nameLower.includes('david');
    return matchesPattern && !isRobotic && v.lang.startsWith('en');
  }) || voices.find(v => {
    const nameLower = v.name.toLowerCase();
    return v.lang.startsWith('en') && !nameLower.includes('zira') && !nameLower.includes('hazel') && !nameLower.includes('david');
  }) || voices.find(v => v.lang.startsWith('en')) || null;
};

export const playStartupVoice = (
  text = "Welcome to FOMOCLIX. Trading engine and live data feeds are initialized."
) => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const speak = () => {
    try {
      window.speechSynthesis.cancel();
      const cleanText = text
        .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
        .replace(/\*([\s\S]*?)\*/g, '$1')
        .replace(/`/g, '')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      const femaleVoice = getFemaleVoice();
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }
      utterance.pitch = 1.08; // Expressive pitch matching AI Orchestrator Chat
      utterance.rate = 0.98;  // Conversational tempo

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[StartupVoice] Speech synthesis error:', err);
    }
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    speak();
  } else {
    const handler = () => {
      speak();
      window.speechSynthesis.onvoiceschanged = null;
    };
    window.speechSynthesis.onvoiceschanged = handler;
    // Fallback in case onvoiceschanged does not fire
    setTimeout(speak, 300);
  }
};
