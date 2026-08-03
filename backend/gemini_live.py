import os
from google import genai
from google.genai.types import LiveConnectConfig, SpeechConfig, VoiceConfig, PrebuiltVoiceConfig

def get_live_config():
    # Configure voice/speech to use the friendly, natural female voice "Aoede"
    config = LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=SpeechConfig(
            voice_config=VoiceConfig(
                prebuilt_voice_config=PrebuiltVoiceConfig(
                    voice_name="Aoede"
                )
            )
        )
    )
    return config

def main():
    # Use the AQ. API key if provided or read from GEMINI_API_KEY env var
    api_key = os.environ.get("GEMINI_API_KEY", "AQ...")
    print(f"Initializing Gemini Live Client with key starting with: {api_key[:4]}")
    client = genai.Client(api_key=api_key)
    
    config = get_live_config()
    print("Voice config initialized successfully: Voice = Aoede")
    return client, config

if __name__ == "__main__":
    main()
