import { useEffect, useRef, useState } from 'react';

// Browser near-realtime voice session.
// Props:
//   onClose()                 — end session
//   onSubmitText(text)        — submit a text turn to the chat pipeline
//   onStop()                  — abort current assistant stream
//   onBuildEstimate()         — trigger estimate build
//   pendingEstimate           — current pending estimate (or null)
//   busy                      — true while assistant is responding
//   lastAssistantText         — latest completed assistant message (for TTS)

export function VoicePanel({ onClose, onSubmitText, onStop, onBuildEstimate, pendingEstimate, busy, lastAssistantText }) {
  const [status, setStatus] = useState('idle');
  const [interimText, setInterimText] = useState('');
  const [voiceLog, setVoiceLog] = useState([]);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [micMuted, setMicMuted] = useState(false);

  const recRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const finalBufRef = useRef('');
  const lastSentRef = useRef('');
  const aliveRef = useRef(true);
  const speakerRef = useRef(true);
  const micMutedRef = useRef(false);
  const busyRef = useRef(busy);
  const prevBusyRef = useRef(busy);
  const pendingTurnRef = useRef(false); // true after we submitted a voice turn, awaiting response

  useEffect(() => { speakerRef.current = speakerOn; }, [speakerOn]);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Detect busy transition to speak the assistant response
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!aliveRef.current) return;
    if (!wasBusy && busy) {
      setStatus('thinking');
    }
    if (wasBusy && !busy && pendingTurnRef.current) {
      pendingTurnRef.current = false;
      if (lastAssistantText) {
        setVoiceLog(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.text === lastAssistantText) return prev;
          return [...prev, { role: 'assistant', text: lastAssistantText }];
        });
        speakText(lastAssistantText);
      } else {
        setStatus('idle');
      }
    }
  }, [busy, lastAssistantText]);

  function speakText(text) {
    if (!speakerRef.current || !text?.trim() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text
      .replace(/\[ESTIMATE_READY\][\s\S]*?\[\/ESTIMATE_READY\]/g, '')
      .replace(/\[STAGED:[^\]]*\]/g, '')
      .replace(/```[\s\S]*?```/g, 'code block. ')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/#{1,6} /g, '')
      .replace(/\|[^\n]+\|(\n|$)/g, '')
      .trim();
    if (!clean) { if (aliveRef.current) setStatus('idle'); return; }
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = 'en-US';
    utt.rate = 1.05;
    utt.onstart = () => { if (aliveRef.current) setStatus('speaking'); };
    utt.onend = () => { if (aliveRef.current) setStatus('idle'); };
    utt.onerror = () => { if (aliveRef.current) setStatus('idle'); };
    window.speechSynthesis.speak(utt);
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    if (aliveRef.current) setStatus('idle');
  }

  function autoSend() {
    const text = finalBufRef.current.trim();
    if (!text || text === lastSentRef.current) {
      finalBufRef.current = '';
      setInterimText('');
      return;
    }
    if (text.split(/\s+/).filter(Boolean).length < 1) {
      finalBufRef.current = '';
      setInterimText('');
      return;
    }
    lastSentRef.current = text;
    finalBufRef.current = '';
    setInterimText('');
    pendingTurnRef.current = true;
    setStatus('submitting');
    setVoiceLog(prev => [...prev, { role: 'user', text }]);
    onSubmitText(text);
  }

  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('unavailable'); return; }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recRef.current = rec;

    rec.onresult = (e) => {
      if (!aliveRef.current || micMutedRef.current) return;

      // Interrupt TTS when user starts speaking
      if (window.speechSynthesis?.speaking) {
        window.speechSynthesis.cancel();
        if (busyRef.current) onStop?.();
        setStatus('interrupted');
        setTimeout(() => { if (aliveRef.current) setStatus('listening'); }, 300);
      }

      clearTimeout(silenceTimerRef.current);

      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalBufRef.current += e.results[i][0].transcript + ' ';
        else interim = e.results[i][0].transcript;
      }
      const display = finalBufRef.current + interim;
      setInterimText(display);
      if (display.trim()) setStatus('listening');

      if (finalBufRef.current.trim()) {
        silenceTimerRef.current = setTimeout(autoSend, 1200);
      }
    };

    rec.onend = () => {
      if (aliveRef.current && !micMutedRef.current) {
        setTimeout(() => {
          if (aliveRef.current && recRef.current === rec) try { rec.start(); } catch {}
        }, 200);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') { setStatus('error'); return; }
      if (aliveRef.current) setTimeout(() => { if (aliveRef.current) startRecognition(); }, 1000);
    };

    try { rec.start(); } catch {}
  }

  useEffect(() => {
    aliveRef.current = true;
    startRecognition();
    return () => {
      aliveRef.current = false;
      clearTimeout(silenceTimerRef.current);
      recRef.current?.abort();
      recRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  const STATUS_LABELS = {
    idle: '● Listening…',
    listening: '🎙 Hearing you…',
    submitting: '→ Sending…',
    thinking: '⟳ Maverick thinking…',
    speaking: '◈ Maverick speaking…',
    interrupted: '⚡ Interrupted',
    error: '✗ Mic error — check permissions',
    unavailable: '✗ Voice unavailable (use Chrome)',
  };

  const items = (pendingEstimate?.items || []).length + (pendingEstimate?.newItems || []).length;

  return (
    <div className="voicePanel">
      <div className="voicePanelHeader">
        <span className="voicePanelStatus" data-status={status}>{STATUS_LABELS[status] || '● Ready'}</span>
        <div className="voicePanelHeaderActions">
          <button
            className={`voicePanelBtn${speakerOn ? '' : ' voiceBtnOff'}`}
            onClick={() => { const next = !speakerOn; setSpeakerOn(next); if (!next) stopSpeaking(); }}
            title={speakerOn ? 'Mute speaker' : 'Unmute speaker'}
            type="button"
          >{speakerOn ? '🔊' : '🔇'}</button>
          <button
            className={`voicePanelBtn${micMuted ? ' voiceBtnOff' : ''}`}
            onClick={() => {
              const next = !micMuted;
              setMicMuted(next);
              if (next) recRef.current?.stop();
              else startRecognition();
            }}
            title={micMuted ? 'Unmute mic' : 'Mute mic'}
            type="button"
          >{micMuted ? '🚫' : '🎙'}</button>
          {status === 'speaking' && (
            <button className="voicePanelBtn" onClick={stopSpeaking} title="Stop speaking" type="button">⏹</button>
          )}
          <button className="voicePanelClose" onClick={onClose} type="button">✕ END</button>
        </div>
      </div>

      <div className="voiceTranscript">
        {voiceLog.map((t, i) => (
          <div key={i} className={`voiceLine ${t.role}`}>
            <span className="voiceRole">{t.role === 'user' ? 'YOU' : 'MAV'}</span>
            <span className="voiceText">{t.text}</span>
          </div>
        ))}
        {interimText && (
          <div className="voiceLine user voiceInterim">
            <span className="voiceRole">YOU</span>
            <span className="voiceText">{interimText}…</span>
          </div>
        )}
        {voiceLog.length === 0 && !interimText && (
          <div className="voiceHint">Start speaking — Maverick is listening.</div>
        )}
      </div>

      {pendingEstimate && items > 0 && (
        <div className="voiceEstimateBar">
          <span className="voiceEstimateInfo">
            📋 <strong>{items} item{items !== 1 ? 's' : ''}</strong>
            {pendingEstimate.customer?.name ? ` — ${pendingEstimate.customer.name}` : ''}
          </span>
          <button className="voiceEstimateBuild" onClick={onBuildEstimate} disabled={busy} type="button">
            ⚡ BUILD IT
          </button>
        </div>
      )}

      {interimText && !busy && (
        <div className="voiceManualSend">
          <button
            className="voiceManualSendBtn"
            onClick={() => { clearTimeout(silenceTimerRef.current); autoSend(); }}
            type="button"
          >→ SEND NOW</button>
        </div>
      )}
    </div>
  );
}
