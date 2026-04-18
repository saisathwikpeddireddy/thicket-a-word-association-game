// Thicket — a quiet word association game
// Design: Japandi × biophilic × forest floor
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const GAME_SECONDS = 120;

// ---------- Claude API helpers ----------

async function callClaude({ prompt, task }) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, task }),
  });
  if (!res.ok) throw new Error('claude api error');
  const data = await res.json();
  return data.text || '';
}

async function claudeNextWord(history, userWord) {
  const recent = history.slice(-10).map(h => `${h.who === 'user' ? 'Player' : 'You'}: ${h.word}`).join('\n');
  const prompt = `You are playing a two-minute word-association improv game with a human. You alternate single words. The human just said: "${userWord}".

Recent exchange:
${recent || '(none yet)'}

Respond with EXACTLY ONE single lowercase word (1-2 syllables preferred, no punctuation, no quotes, no explanation) that feels like a natural, playful association from "${userWord}". Aim for the Goldilocks zone — not the most obvious rhyme/synonym, not something try-hard. Surprising but inevitable. Never repeat a word already in the exchange.

Your word:`;
  try {
    const text = await callClaude({ prompt, task: 'word' });
    const cleaned = (text || '').trim().toLowerCase().replace(/[^a-z'\-]/g, '').slice(0, 24);
    return cleaned || fallbackWord(userWord, history);
  } catch (e) { return fallbackWord(userWord, history); }
}

function fallbackWord(userWord, history) {
  const pool = ['moss','river','lantern','thread','hollow','ember','basket','shadow','hush','pebble','drift','thistle','amber','kettle','petal','marrow','linen','dusk','bramble','harbor'];
  const used = new Set(history.map(h => h.word).concat([userWord]));
  return pool.find(w => !used.has(w)) || 'quiet';
}

async function claudeScoreGame(rounds, avgResponseMs) {
  const transcript = rounds.map((r,i) => `${i+1}. Player: ${r.user} (${((r.userMs||0)/1000).toFixed(1)}s) → You: ${r.claude || '—'}`).join('\n');
  const userWords = rounds.map(r => r.user).filter(Boolean);
  const prompt = `You just finished a 2-minute word-association improv game with a human.

Transcript:
${transcript}

Stats:
- Turns completed: ${rounds.length}
- Avg response time: ${(avgResponseMs/1000).toFixed(1)}s

Evaluate the PLAYER'S word choices on a "Goldilocks" axis — the sweet spot between too-obvious (dog→cat) and too-try-hard (dog→sepulchral). Surprising but inevitable.

Return ONLY valid JSON, no code fences, no prose:
{
  "quality": <integer 0-100, overall Goldilocks score>,
  "perWord": [<integer 0-100 for each player word in order, exactly ${userWords.length} numbers>],
  "standout": "<single word from their list that was the best association>",
  "weakest": "<single word from their list that was the most obvious or try-hard, or empty string if none>",
  "note": "<2-3 sentences of warm, specific coaching. Reference at least two actual words they chose (use these words exactly: ${userWords.slice(0,6).map(w=>`"${w}"`).join(', ')}). Sound like a thoughtful friend, not a grader. No exclamation marks.>"
}`;
  try {
    const text = await callClaude({ prompt, task: 'score' });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      let perWord = Array.isArray(parsed.perWord) ? parsed.perWord.map(n => Math.max(0, Math.min(100, parseInt(n)||50))) : [];
      while (perWord.length < userWords.length) perWord.push(parsed.quality || 60);
      perWord = perWord.slice(0, userWords.length);
      return {
        quality: Math.max(0, Math.min(100, parseInt(parsed.quality) || 50)),
        perWord,
        standout: String(parsed.standout || '').toLowerCase().trim(),
        weakest: String(parsed.weakest || '').toLowerCase().trim(),
        note: String(parsed.note || '').trim()
      };
    }
  } catch(e) {}
  const perWord = rounds.map(r => {
    const s = (r.userMs || 3000) / 1000;
    if (s < 1.5) return 45 + Math.random() * 15;
    if (s < 4) return 60 + Math.random() * 20;
    if (s < 8) return 65 + Math.random() * 20;
    return 55 + Math.random() * 20;
  }).map(n => Math.round(n));
  return {
    quality: 62,
    perWord,
    standout: userWords[Math.floor(userWords.length/2)] || '',
    weakest: '',
    note: `You found some lovely turns — ${userWords[0] || 'your first word'} opened a door, and ${userWords[Math.floor(userWords.length/2)] || 'the middle'} kept it honest. Next time, trust the second thought a little more than the first.`
  };
}

// ---------- Illustrations ----------

function LeafIcon({ size = 14, color = 'currentColor', sway }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ transformOrigin: '12px 22px', animation: sway ? 'sway 4.2s ease-in-out infinite' : 'none' }}>
      <path d="M12 22 C 12 14, 6 10, 4 4 C 10 4, 18 8, 20 14 C 20 18, 16 22, 12 22 Z"
        stroke={color} strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
      <path d="M12 22 C 12 16, 14 10, 18 6" stroke={color} strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

function SeedIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="5" ry="8" stroke={color} strokeWidth="1.3" fill="none" transform="rotate(-20 12 12)"/>
      <path d="M12 4 C 14 8, 14 16, 12 20" stroke={color} strokeWidth="0.9" fill="none" opacity="0.6" transform="rotate(-20 12 12)"/>
    </svg>
  );
}

function Sprig({ style }) {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" style={{ ...style }}>
      <path d="M60 110 L60 20" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5"/>
      <g opacity="0.7">
        <path d="M60 90 C 50 90, 42 84, 40 76 C 48 76, 56 82, 60 90 Z" fill="currentColor" opacity="0.35"/>
        <path d="M60 75 C 70 75, 78 69, 80 61 C 72 61, 64 67, 60 75 Z" fill="currentColor" opacity="0.4"/>
        <path d="M60 58 C 50 58, 42 52, 40 44 C 48 44, 56 50, 60 58 Z" fill="currentColor" opacity="0.45"/>
        <path d="M60 42 C 70 42, 78 36, 80 28 C 72 28, 64 34, 60 42 Z" fill="currentColor" opacity="0.5"/>
        <circle cx="60" cy="20" r="3" fill="currentColor" opacity="0.6"/>
      </g>
    </svg>
  );
}

function DriftLayer({ count = 6 }) {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{
          position: 'absolute',
          left: `${(i * 137) % 100}%`,
          top: `${(i * 71) % 100}%`,
          width: 3, height: 3, borderRadius: '50%',
          background: 'var(--moss-soft)',
          opacity: 0.25,
          animation: `drift ${18 + (i % 5) * 4}s ease-in-out ${i * 1.3}s infinite`,
        }}/>
      ))}
    </div>
  );
}

function BreathDot({ active, color = 'var(--moss)' }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: active ? color : 'var(--stone-2)',
      transition: 'background 900ms ease',
      animation: active ? 'breathe 3.2s ease-in-out infinite' : 'none',
      verticalAlign: 'middle', marginRight: 10,
    }}/>
  );
}

function SpeakerPill({ who, size = 'sm' }) {
  const isUser = who === 'user';
  const small = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: small ? 5 : 7,
      padding: small ? '2px 8px' : '4px 11px',
      borderRadius: 999,
      background: isUser ? 'var(--user-tint)' : 'var(--claude-tint)',
      border: `1px solid ${isUser ? 'var(--user-line)' : 'var(--claude-line)'}`,
      color: isUser ? 'var(--user-ink)' : 'var(--claude-ink)',
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: small ? 10 : 11,
      fontWeight: 500,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      verticalAlign: 'middle',
      lineHeight: 1,
      whiteSpace: 'nowrap',
    }}>
      {isUser
        ? <SeedIcon size={small ? 10 : 12} />
        : <LeafIcon size={small ? 10 : 12} sway />
      }
      {isUser ? 'you' : 'claude'}
    </span>
  );
}

// ---------- Start Screen ----------

function StartScreen({ onStart }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid', placeItems: 'center',
      padding: '40px 24px',
      animation: 'fade-in 1.2s ease',
      position: 'relative',
    }}>
      <DriftLayer count={10} />

      <div style={{
        position: 'relative', zIndex: 2,
        width: '100%', maxWidth: 640,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 24,
      }}>
        <div>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', marginBottom: 20, fontWeight: 500,
          }}>
            a word association game · two minutes
          </div>

          <h1 className="serif" style={{
            fontSize: 'clamp(56px, 12vw, 104px)',
            fontWeight: 400,
            fontStyle: 'italic',
            lineHeight: 0.95,
            letterSpacing: '-0.02em',
            margin: '0 0 20px',
            color: 'var(--ink)',
          }}>
            Thicket<span style={{ color: 'var(--moss)' }}>.</span>
          </h1>

          <p className="serif" style={{
            fontSize: 'clamp(18px, 2.4vw, 22px)',
            lineHeight: 1.5, color: 'var(--ink-soft)',
            maxWidth: 520, margin: '0 0 14px', fontWeight: 400, textWrap: 'pretty',
          }}>
            You say a word. I answer with one. We take turns for two minutes — the goal isn't speed,
            it's the <em style={{ color: 'var(--moss-deep)' }}>Goldilocks</em>: not too obvious, not too clever.
          </p>

          <p className="serif" style={{
            fontSize: 16, lineHeight: 1.55, color: 'var(--stone)',
            maxWidth: 480, margin: '0 0 32px', fontStyle: 'italic', fontWeight: 400,
          }}>
            Type. Press enter. Let the next word come.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 32, flexWrap: 'wrap' }}>
            <SpeakerPill who="user" />
            <SpeakerPill who="claude" />
          </div>

          <button onClick={onStart} style={{
            background: 'var(--moss)', color: 'var(--paper)',
            border: 'none', padding: '16px 36px',
            fontFamily: 'inherit', fontSize: 18, fontWeight: 500, letterSpacing: '0.02em',
            cursor: 'pointer', borderRadius: 2,
            transition: 'background 400ms ease, transform 200ms ease',
            boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 10px 24px -18px rgba(63,75,50,0.8)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--moss-deep)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--moss)'; }}
          >
            Begin
          </button>
        </div>

        <div style={{ color: 'var(--moss-soft)', display: 'grid', placeItems: 'center' }} className="hide-on-narrow">
          <Sprig />
        </div>
      </div>
    </div>
  );
}

// ---------- Play Screen ----------

function PlayScreen({ onEnd }) {
  const [rounds, setRounds] = useState([]);
  const [seed, setSeed] = useState(null);
  const [input, setInput] = useState('');
  const [waitingClaude, setWaitingClaude] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [started, setStarted] = useState(false);

  const inputRef = useRef(null);
  const startTimeRef = useRef(null);
  const turnStartRef = useRef(null);
  const endedRef = useRef(false);
  const trailEndRef = useRef(null);

  useEffect(() => {
    (async () => {
      const openers = ['rain','window','ember','pocket','river','threshold','clover','lantern'];
      const opener = openers[Math.floor(Math.random()*openers.length)];
      await new Promise(r => setTimeout(r, 650));
      setSeed(opener);
      setStarted(true);
      startTimeRef.current = Date.now();
      turnStartRef.current = Date.now();
      setTimeout(() => inputRef.current?.focus(), 100);
    })();
  }, []);

  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const left = Math.max(0, GAME_SECONDS - elapsed);
      setTimeLeft(left);
      if (left <= 0 && !endedRef.current) {
        endedRef.current = true;
        clearInterval(id);
        const times = rounds.map(r => r.userMs).filter(Boolean);
        const avg = times.length ? times.reduce((a,b)=>a+b,0)/times.length : 0;
        onEnd({ rounds, avgResponseMs: avg });
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, rounds, onEnd]);

  const submit = useCallback(async () => {
    const word = input.trim().toLowerCase().replace(/[^a-z'\-]/g, '').slice(0, 24);
    if (!word || waitingClaude || endedRef.current) return;

    const userMs = Date.now() - turnStartRef.current;
    setInput('');
    setWaitingClaude(true);

    const history = [];
    if (seed) history.push({ who: 'claude', word: seed });
    rounds.forEach(r => {
      history.push({ who: 'user', word: r.user });
      if (r.claude) history.push({ who: 'claude', word: r.claude });
    });

    setRounds(rs => [...rs, { user: word, claude: null, userMs, userAt: Date.now() - startTimeRef.current }]);

    const claudeWord = await claudeNextWord(history, word);
    if (endedRef.current) return;
    await new Promise(r => setTimeout(r, 450));

    setRounds(rs => {
      const next = [...rs];
      next[next.length - 1] = { ...next[next.length - 1], claude: claudeWord, claudeAt: Date.now() - startTimeRef.current };
      return next;
    });
    setWaitingClaude(false);
    turnStartRef.current = Date.now();
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [input, waitingClaude, seed, rounds]);

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };

  const trail = useMemo(() => {
    const items = [];
    if (seed) items.push({ who: 'claude', word: seed, key: 'seed' });
    rounds.forEach((r, i) => {
      items.push({ who: 'user', word: r.user, key: `u${i}` });
      if (r.claude) items.push({ who: 'claude', word: r.claude, key: `c${i}` });
    });
    return items;
  }, [seed, rounds]);

  useEffect(() => {
    if (trailEndRef.current) {
      const parent = trailEndRef.current.parentElement?.parentElement;
      if (parent) parent.scrollTop = parent.scrollHeight;
    }
  }, [trail.length]);

  const lastWord = trail.length ? trail[trail.length - 1] : null;
  const turnsCompleted = rounds.filter(r => r.claude).length;
  const progress = timeLeft / GAME_SECONDS;
  const secondsLeft = Math.ceil(timeLeft);
  const whoseTurn = waitingClaude ? 'claude' : 'you';

  const leavesFalling = useMemo(() => {
    const n = Math.min(3, Math.floor((GAME_SECONDS - timeLeft) / 30));
    return Array.from({ length: n });
  }, [timeLeft]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr',
      animation: 'fade-in 900ms ease',
      position: 'relative',
    }}>
      <DriftLayer count={5} />

      <div className="play-top" style={{
        padding: '20px clamp(16px, 4vw, 48px) 0',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        position: 'relative', zIndex: 2,
      }}>
        <div className="mono" style={{
          fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500,
          display: 'flex', alignItems: 'center',
        }}>
          <BreathDot active={whoseTurn==='you'} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>{whoseTurn === 'you' ? 'your turn' : 'claude listening'}</span>
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div className="mono" style={{
          fontSize: 11, letterSpacing: '0.18em', color: 'var(--stone)', fontWeight: 500,
          textTransform: 'uppercase',
        }}>
          {String(turnsCompleted).padStart(2,'0')} turns
        </div>

        <div style={{ width: 1, height: 14, background: 'var(--line)' }} />

        <div className="mono" style={{
          fontSize: 16, letterSpacing: '0.1em', color: 'var(--ink)', fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {String(Math.floor(secondsLeft/60))}:{String(secondsLeft%60).padStart(2,'0')}
        </div>
      </div>

      <div style={{ position: 'relative', padding: '12px clamp(16px, 4vw, 48px) 0' }}>
        <div style={{ height: 1, background: 'var(--line-soft)', position: 'relative', overflow: 'visible' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${progress*100}%`,
            background: progress < 0.15 ? 'var(--clay)' : 'var(--moss-soft)',
            transition: 'width 120ms linear, background 800ms ease',
          }}/>
          <div style={{
            position: 'absolute', left: `${progress*100}%`, top: -6, color: 'var(--moss-deep)',
            transform: 'translateX(-50%)', opacity: progress > 0 ? 1 : 0, transition: 'opacity 400ms',
          }}>
            <LeafIcon size={12} />
          </div>
          {leavesFalling.map((_, i) => (
            <span key={i} aria-hidden="true" style={{
              position: 'absolute', top: 0, left: `${20 + i*30}%`,
              color: 'var(--moss-soft)',
              animation: `fall ${6 + i}s linear ${i * 2}s infinite`, opacity: 0.5,
            }}>
              <LeafIcon size={10} />
            </span>
          ))}
        </div>
      </div>

      <div className="play-main" style={{ position: 'relative', zIndex: 1 }}>
        <div className="trail-pane">
          <div className="mono" style={{
            fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
          }}>
            the trail
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trail.slice(0, -1).map((w, i) => (
              <TrailWord key={w.key} word={w.word} who={w.who} index={i} />
            ))}
            <div ref={trailEndRef} />
          </div>
        </div>

        <div className="focus-pane">
          {lastWord && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <SpeakerPill who={lastWord.who} />
                <div style={{
                  flex: 1, height: 1, background: 'var(--line)',
                  transformOrigin: 'left',
                  animation: 'line-sweep 1.2s ease-out',
                }}/>
              </div>
              <div
                key={lastWord.key}
                className="serif focus-word"
                data-who={lastWord.who}
                style={{
                  fontSize: 'clamp(56px, 11vw, 120px)',
                  fontWeight: 400,
                  fontStyle: lastWord.who === 'claude' ? 'var(--claude-style, italic)' : 'normal',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  color: lastWord.who === 'claude' ? 'var(--claude-ink)' : 'var(--ink)',
                  animation: 'word-arrive 900ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                  wordBreak: 'break-word',
                  position: 'relative',
                  display: 'inline-block',
                }}
              >
                {lastWord.word}
                <span style={{
                  position: 'absolute', left: 0, right: '30%', bottom: -6, height: 2,
                  background: lastWord.who === 'claude' ? 'var(--claude-line)' : 'var(--user-line)',
                  transformOrigin: 'left',
                  animation: 'line-sweep 1.6s ease-out 200ms forwards',
                  transform: 'scaleX(0)',
                }}/>
              </div>
            </div>
          )}

          <div style={{ width: '100%', maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <SpeakerPill who="user" />
              <span className="mono" style={{ fontSize: 11, color: 'var(--stone)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                your word
              </span>
            </div>
            <div style={{
              borderBottom: `2px solid ${waitingClaude ? 'var(--stone-2)' : 'var(--user-line)'}`,
              paddingBottom: 10,
              display: 'flex', alignItems: 'baseline', gap: 10,
              transition: 'border-color 500ms ease',
            }}>
              <span className="mono" style={{ color: 'var(--user-line)', fontSize: 18, fontWeight: 500 }}>›</span>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.replace(/\s/g, '').slice(0, 24))}
                onKeyDown={onKey}
                disabled={waitingClaude}
                placeholder={waitingClaude ? 'claude is considering…' : 'type a single word'}
                className="serif"
                style={{
                  flex: 1, minWidth: 0,
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 400, fontFamily: 'inherit',
                  color: 'var(--ink)', letterSpacing: '-0.01em',
                }}
              />
              {waitingClaude && <ThinkingDots />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{
                fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500,
              }}>
                enter to send · one word
              </span>
              <button onClick={() => {
                endedRef.current = true;
                const times = rounds.map(r => r.userMs).filter(Boolean);
                const avg = times.length ? times.reduce((a,b)=>a+b,0)/times.length : 0;
                onEnd({ rounds, avgResponseMs: avg });
              }} className="mono" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--stone)', padding: 0, fontWeight: 500, fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--ink)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--stone)'}
              >
                end early ↗
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .play-main {
          display: grid;
          grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
          gap: clamp(24px, 4vw, 48px);
          padding: clamp(20px, 3vw, 36px) clamp(16px, 4vw, 48px) clamp(20px, 3vw, 36px);
          overflow: hidden;
        }
        .trail-pane {
          max-height: calc(100vh - 180px);
          overflow-y: auto;
          padding-right: 8px;
          mask-image: linear-gradient(180deg, transparent 0, #000 40px, #000 calc(100% - 16px), transparent 100%);
        }
        .focus-pane {
          display: flex; flex-direction: column; justify-content: center;
          min-width: 0;
        }
        @media (max-width: 760px) {
          .play-main {
            grid-template-columns: 1fr;
            gap: 24px;
            padding: 20px 16px;
          }
          .trail-pane {
            max-height: 28vh;
            order: 2;
            mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), transparent 100%);
          }
          .focus-pane {
            order: 1;
          }
        }
      `}</style>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: 'var(--moss-soft)',
          animation: `thinking 1.4s ease-in-out ${i*0.2}s infinite`,
        }}/>
      ))}
    </span>
  );
}

function TrailWord({ word, who, index }) {
  const delay = Math.min(index * 25, 250);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '4px 8px 4px 0',
        borderRadius: 3,
        animation: `word-settle 600ms cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms both`,
      }}
    >
      <span className="mono" style={{
        fontSize: 10, letterSpacing: '0.1em',
        color: 'var(--stone-2)', width: 22, flexShrink: 0,
        fontVariantNumeric: 'tabular-nums', fontWeight: 500,
        textAlign: 'right',
      }}>
        {String(index+1).padStart(2,'0')}
      </span>
      <SpeakerPill who={who} />
      <span className="serif" style={{
        fontSize: 20,
        fontWeight: 400,
        fontStyle: who === 'claude' ? 'var(--claude-style, italic)' : 'normal',
        color: who === 'claude' ? 'var(--claude-ink)' : 'var(--ink)',
        letterSpacing: '-0.01em',
        wordBreak: 'break-word',
      }}>
        {word}
      </span>
    </div>
  );
}

// ---------- End Screen ----------

function EndScreen({ rounds, avgResponseMs, onRestart }) {
  const [scoring, setScoring] = useState(true);
  const [scoreData, setScoreData] = useState(null);
  const [quality, setQuality] = useState(0);
  const [typed, setTyped] = useState('');
  const [revealed, setRevealed] = useState({ turns: false, quality: false, time: false, journey: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise(r => setTimeout(r, 900));
      const result = await claudeScoreGame(rounds, avgResponseMs);
      if (cancelled) return;
      setScoreData(result);
      setScoring(false);
      const target = result.quality;
      const startAt = Date.now();
      const dur = 1400;
      const tick = () => {
        const t = Math.min(1, (Date.now()-startAt)/dur);
        const eased = 1 - Math.pow(1-t, 3);
        setQuality(Math.round(eased * target));
        if (t < 1) requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => { cancelled = true; };
  }, [rounds, avgResponseMs]);

  useEffect(() => {
    if (scoring) return;
    const t1 = setTimeout(() => setRevealed(r => ({ ...r, turns: true })), 200);
    const t2 = setTimeout(() => setRevealed(r => ({ ...r, quality: true })), 700);
    const t3 = setTimeout(() => setRevealed(r => ({ ...r, time: true })), 1200);
    const t4 = setTimeout(() => setRevealed(r => ({ ...r, journey: true })), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [scoring]);

  const note = scoreData?.note || '';
  useEffect(() => {
    if (!note) return;
    const startDelay = setTimeout(() => {
      let i = 0;
      const id = setInterval(() => {
        i++;
        setTyped(note.slice(0, i));
        if (i >= note.length) clearInterval(id);
      }, 26);
      return () => clearInterval(id);
    }, 2200);
    return () => clearTimeout(startDelay);
  }, [note]);

  const turnsCompleted = rounds.filter(r => r.claude).length;
  const avgSec = (avgResponseMs/1000).toFixed(1);

  return (
    <div style={{
      minHeight: '100vh', overflow: 'auto',
      animation: 'fade-in 1.2s ease',
      position: 'relative',
    }}>
      <DriftLayer count={8} />
      <div style={{
        maxWidth: 960, margin: '0 auto',
        padding: 'clamp(40px, 6vw, 64px) clamp(20px, 4vw, 48px)',
        position: 'relative', zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', fontWeight: 500,
          }}>
            the round is complete
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--line)', maxWidth: 200 }}/>
          <span style={{ color: 'var(--moss-soft)' }}><LeafIcon size={16} sway /></span>
        </div>

        <h2 className="serif" style={{
          fontSize: 'clamp(36px, 5.5vw, 56px)',
          fontWeight: 400, fontStyle: 'italic',
          lineHeight: 1.05, letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: '0 0 40px',
          maxWidth: 720, textWrap: 'pretty',
        }}>
          {scoring ? 'Claude is reading back through the trail' : 'Here is what the trail looked like'}
          <span style={{ color: 'var(--moss)' }}>.</span>
        </h2>

        <div className="metrics-grid">
          <MetricCard
            label="turns completed" value={turnsCompleted} unit=""
            revealed={revealed.turns} hint={turnsHint(turnsCompleted)}
          />
          <MetricCard
            label="word quality" value={scoring ? '—' : quality}
            unit={scoring ? '' : '/ 100'} revealed={revealed.quality}
            hint="the goldilocks" accent loading={scoring}
          />
          <MetricCard
            label="avg response" value={scoring ? '—' : avgSec} unit="sec"
            revealed={revealed.time} hint={timeHint(parseFloat(avgSec))}
          />
        </div>

        <div style={{ marginTop: 56, maxWidth: 740 }}>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <SpeakerPill who="claude" />
            <span>a note for you</span>
          </div>
          <div className="serif" style={{
            fontSize: 'clamp(20px, 2.6vw, 26px)', lineHeight: 1.5, fontWeight: 400,
            color: 'var(--ink)',
            minHeight: 80,
            fontStyle: 'var(--claude-style, italic)',
            textWrap: 'pretty',
            paddingLeft: 16, borderLeft: '2px solid var(--claude-line)',
          }}>
            {typed}
            {typed.length < (note?.length||0) && typed.length > 0 && (
              <span style={{
                display: 'inline-block', width: 2, height: '0.9em',
                background: 'var(--moss)', marginLeft: 3, verticalAlign: 'text-bottom',
                animation: 'cursor-blink 1s steps(2) infinite',
              }}/>
            )}
            {scoring && (
              <span style={{ color: 'var(--stone)', fontSize: 18 }}>
                thinking quietly <ThinkingDots />
              </span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 48, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onRestart} style={{
            background: 'var(--moss)', color: 'var(--paper)',
            border: 'none', padding: '16px 32px',
            fontFamily: 'inherit', fontSize: 17, fontWeight: 500, letterSpacing: '0.02em',
            cursor: 'pointer', borderRadius: 2,
            transition: 'background 400ms ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--moss-deep)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--moss)'}
          >
            Another round
          </button>
        </div>

        {rounds.length > 0 && (
          <div style={{
            marginTop: 56,
            opacity: revealed.journey ? 1 : 0,
            transform: revealed.journey ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 900ms ease, transform 900ms cubic-bezier(0.2,0.8,0.2,1)',
          }}>
            <div className="mono" style={{
              fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--stone)', marginBottom: 18, fontWeight: 500,
            }}>
              the journey · two minutes
            </div>
            <Journey rounds={rounds} perWord={scoreData?.perWord || []} standout={scoreData?.standout} weakest={scoreData?.weakest} />
          </div>
        )}

        {rounds.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <div className="mono" style={{
              fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--stone)', marginBottom: 18, fontWeight: 500,
            }}>
              the trail, in full
            </div>
            <div className="transcript-grid">
              {(() => {
                const items = [];
                let userIdx = 0;
                rounds.forEach((r, i) => {
                  items.push({ who: 'user', word: r.user, n: i*2+1, quality: scoreData?.perWord?.[userIdx], seconds: (r.userMs||0)/1000 });
                  userIdx++;
                  if (r.claude) items.push({ who: 'claude', word: r.claude, n: i*2+2 });
                });
                return items.map((it, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    background: it.who === 'user' ? 'var(--user-tint)' : 'var(--claude-tint)',
                    border: `1px solid ${it.who === 'user' ? 'var(--user-line)' : 'var(--claude-line)'}`,
                    borderRadius: 3,
                    animation: `fade-in 500ms ease ${idx * 30}ms both`,
                  }}>
                    <span className="mono" style={{
                      fontSize: 10, color: 'var(--stone)', fontWeight: 500,
                      fontVariantNumeric: 'tabular-nums', width: 18, flexShrink: 0,
                    }}>
                      {String(it.n).padStart(2,'0')}
                    </span>
                    <span style={{ flexShrink: 0 }}>
                      {it.who === 'user' ? <SeedIcon size={11} color="var(--user-ink)"/> : <LeafIcon size={11} color="var(--claude-ink)"/>}
                    </span>
                    <span className="serif" style={{
                      flex: 1,
                      fontSize: 17, fontWeight: 400,
                      fontStyle: it.who === 'claude' ? 'var(--claude-style, italic)' : 'normal',
                      color: it.who === 'claude' ? 'var(--claude-ink)' : 'var(--ink)',
                      letterSpacing: '-0.01em',
                      wordBreak: 'break-word',
                    }}>
                      {it.word}
                    </span>
                    {it.who === 'user' && typeof it.quality === 'number' && (
                      <span className="mono" style={{
                        fontSize: 10, color: qualityColor(it.quality), fontWeight: 500,
                        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                      }} title={`quality ${it.quality} · ${it.seconds.toFixed(1)}s`}>
                        {it.quality}
                      </span>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px;
          background: var(--line);
          border-top: 1px solid var(--line);
          border-bottom: 1px solid var(--line);
        }
        .transcript-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 8px;
        }
        @media (max-width: 640px) {
          .metrics-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function qualityColor(q) {
  if (q >= 78) return 'var(--moss-deep)';
  if (q >= 60) return 'var(--moss)';
  if (q >= 45) return 'var(--stone)';
  return 'var(--clay)';
}

function Journey({ rounds, perWord, standout, weakest }) {
  const [hover, setHover] = useState(null);
  const totalMs = GAME_SECONDS * 1000;

  const events = [];
  let userIdx = 0;
  rounds.forEach((r, i) => {
    if (typeof r.userAt === 'number') {
      events.push({
        type: 'user', word: r.user, t: r.userAt, dur: r.userMs || 0,
        quality: perWord[userIdx], idx: userIdx,
        isStandout: standout && standout === r.user,
        isWeakest: weakest && weakest === r.user,
      });
      userIdx++;
    }
    if (r.claude && typeof r.claudeAt === 'number') {
      events.push({ type: 'claude', word: r.claude, t: r.claudeAt, dur: 0 });
    }
  });

  const maxDur = Math.max(1000, ...events.filter(e => e.type==='user').map(e => e.dur));
  const longestPause = events.filter(e => e.type==='user').reduce((best, e) => e.dur > (best?.dur || 0) ? e : best, null);

  return (
    <div style={{
      padding: 'clamp(20px, 2.4vw, 28px)',
      background: 'rgba(255,252,241,0.5)',
      border: '1px solid var(--line)',
      borderRadius: 3,
    }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--user-tint)', border: '1.5px solid var(--user-line)' }}/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500 }}>your words · size = time spent</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <LeafIcon size={10} color="var(--claude-ink)"/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500 }}>claude replies</span>
        </span>
      </div>

      <div style={{ position: 'relative', height: 160, marginTop: 24 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'var(--line)' }}/>

        {[0, 30, 60, 90, 120].map(s => (
          <div key={s} style={{ position: 'absolute', left: `${(s/GAME_SECONDS)*100}%`, top: 0, bottom: 0 }}>
            <div style={{ width: 1, height: '100%', background: 'var(--line-soft)' }}/>
            <div className="mono" style={{
              position: 'absolute', top: '100%', left: 0, transform: 'translateX(-50%)',
              fontSize: 10, color: 'var(--stone)', fontWeight: 500, marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {Math.floor(s/60)}:{String(s%60).padStart(2,'0')}
            </div>
          </div>
        ))}

        {events.map((e, i) => {
          const x = Math.min(100, (e.t / totalMs) * 100);
          const isUser = e.type === 'user';
          const size = isUser ? 10 + (e.dur / maxDur) * 20 : 6;
          const quality = e.quality ?? 55;
          const yOffset = isUser ? -(quality - 50) * 0.7 : 18;
          const color = isUser ? qualityColor(quality) : 'var(--claude-line)';
          return (
            <React.Fragment key={i}>
              {isUser && (
                <div style={{
                  position: 'absolute', left: `${x}%`, top: '50%',
                  width: 1, height: Math.abs(yOffset),
                  background: 'var(--line)',
                  transform: `translateX(-50%) translateY(${yOffset < 0 ? yOffset : 0}px)`,
                }}/>
              )}
              <div
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{
                  position: 'absolute',
                  left: `${x}%`, top: '50%',
                  width: size, height: size, borderRadius: '50%',
                  background: isUser ? color : 'transparent',
                  border: isUser ? `1.5px solid ${color}` : `1.5px solid var(--claude-line)`,
                  transform: `translate(-50%, calc(-50% + ${yOffset}px))`,
                  cursor: 'pointer',
                  transition: 'transform 200ms ease, box-shadow 200ms ease',
                  boxShadow: hover === i ? `0 0 0 4px ${isUser ? 'var(--user-tint)' : 'var(--claude-tint)'}` : 'none',
                  zIndex: hover === i ? 10 : 2,
                  animation: `fade-in 600ms ease ${i * 40}ms both`,
                }}
              />
              {e.isStandout && (
                <div style={{
                  position: 'absolute', left: `${x}%`, top: '50%',
                  transform: `translate(-50%, calc(-50% + ${yOffset}px - ${size/2 + 14}px))`,
                  color: 'var(--moss-deep)',
                }}>
                  <LeafIcon size={12} />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {hover !== null && events[hover] && (() => {
          const e = events[hover];
          const x = Math.min(100, (e.t / totalMs) * 100);
          const isLeft = x > 70;
          return (
            <div style={{
              position: 'absolute', left: `${x}%`, top: '50%',
              transform: `translate(${isLeft ? '-100%' : '0'}, -50%) translateX(${isLeft ? -12 : 12}px)`,
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              padding: '10px 12px',
              borderRadius: 3,
              minWidth: 140,
              boxShadow: '0 8px 24px -12px rgba(42,39,32,0.3)',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <SpeakerPill who={e.type} />
              </div>
              <div className="serif" style={{
                fontSize: 20, fontWeight: 400,
                fontStyle: e.type === 'claude' ? 'italic' : 'normal',
                color: e.type === 'claude' ? 'var(--claude-ink)' : 'var(--ink)',
                lineHeight: 1.1, marginBottom: 4,
              }}>{e.word}</div>
              <div className="mono" style={{
                fontSize: 10, color: 'var(--stone)', letterSpacing: '0.1em', textTransform: 'uppercase',
                fontVariantNumeric: 'tabular-nums',
              }}>
                at {Math.floor(e.t/60000)}:{String(Math.floor((e.t%60000)/1000)).padStart(2,'0')}
                {e.type === 'user' && ` · ${(e.dur/1000).toFixed(1)}s`}
                {e.type === 'user' && typeof e.quality === 'number' && (
                  <span style={{ color: qualityColor(e.quality), marginLeft: 8 }}>· q{e.quality}</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <div style={{
        marginTop: 36, paddingTop: 16, borderTop: '1px solid var(--line-soft)',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16,
      }}>
        {longestPause && (
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500, marginBottom: 4 }}>
              longest pause
            </div>
            <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 400 }}>
              before <em style={{ color: 'var(--moss-deep)' }}>{longestPause.word}</em>
              <span className="mono" style={{ fontSize: 12, color: 'var(--stone)', marginLeft: 8 }}>
                {(longestPause.dur/1000).toFixed(1)}s
              </span>
            </div>
          </div>
        )}
        {standout && (
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500, marginBottom: 4 }}>
              standout
            </div>
            <div className="serif" style={{ fontSize: 18, color: 'var(--moss-deep)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: 6 }}>
              <LeafIcon size={14} color="var(--moss-deep)"/> {standout}
            </div>
          </div>
        )}
        {weakest && (
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500, marginBottom: 4 }}>
              most obvious
            </div>
            <div className="serif" style={{ fontSize: 18, color: 'var(--clay)', fontWeight: 400 }}>
              {weakest}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function turnsHint(n) {
  if (n === 0) return 'a quiet round';
  if (n < 6) return 'deliberate pacing';
  if (n < 14) return 'a steady rhythm';
  if (n < 22) return 'a quick rhythm';
  return 'a sprint';
}
function timeHint(s) {
  if (!s || isNaN(s)) return '';
  if (s < 2) return 'barely a breath between';
  if (s < 5) return 'one breath between';
  if (s < 9) return 'considered';
  return 'you took your time';
}

function MetricCard({ label, value, unit, revealed, hint, accent, loading }) {
  return (
    <div style={{
      padding: 'clamp(20px, 2.4vw, 28px)',
      background: 'var(--paper)',
      opacity: revealed ? 1 : 0,
      transform: revealed ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 900ms ease, transform 900ms cubic-bezier(0.2,0.8,0.2,1)',
      display: 'flex', flexDirection: 'column', gap: 10,
      minHeight: 160,
    }}>
      <div className="mono" style={{
        fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'var(--ink-soft)', fontWeight: 500,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto' }}>
        <span className="serif" style={{
          fontSize: 'clamp(52px, 6.5vw, 80px)',
          fontWeight: 400,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: accent ? 'var(--moss-deep)' : 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
          animation: loading ? 'thinking 1.4s ease-in-out infinite' : 'none',
        }}>
          {value}
        </span>
        {unit && (
          <span className="mono" style={{
            fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--stone)', fontWeight: 500,
          }}>
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="serif" style={{
          fontSize: 15, fontStyle: 'italic', color: 'var(--stone)', fontWeight: 400,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------- Tweaks ----------

const TWEAK_DEFAULTS = {
  textScale: 1,
  contrast: 'normal',
  palette: 'moss',
  grain: 0.35,
  claudeItalic: true,
};

function applyTweaks(t) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', t.textScale);
  root.style.setProperty('--grain', t.grain);
  root.style.setProperty('--claude-style', t.claudeItalic ? 'italic' : 'normal');
  root.setAttribute('data-contrast', t.contrast);
  root.setAttribute('data-palette', t.palette);
  document.body.style.fontSize = `${16 * t.textScale}px`;
}

function TweaksPanel({ tweaks, setTweaks, onClose }) {
  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    applyTweaks(next);
  };
  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--line-soft)' }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'var(--stone)', fontWeight: 500,
      }}>{label}</div>
      {children}
    </div>
  );
  const chip = (active) => ({
    background: active ? 'var(--moss)' : 'transparent',
    color: active ? 'var(--paper)' : 'var(--ink-soft)',
    border: `1px solid ${active ? 'var(--moss)' : 'var(--line)'}`,
    padding: '6px 11px', borderRadius: 999,
    fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', transition: 'all 200ms ease',
  });
  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 100,
      width: 260, padding: 18,
      background: 'rgba(241,236,221,0.96)',
      border: '1px solid var(--line)',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 20px 48px -24px rgba(42,39,32,0.3)',
      borderRadius: 4,
      display: 'flex', flexDirection: 'column', gap: 14,
      animation: 'fade-in 400ms ease',
      maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="serif" style={{ fontSize: 20, fontStyle: 'italic', fontWeight: 400, color: 'var(--ink)' }}>
          Tweaks
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--stone)', fontSize: 18, padding: 0,
        }}>×</button>
      </div>
      <Row label="text size">
        <div style={{ display: 'flex', gap: 5 }}>
          {[{label:'S',val:0.9},{label:'M',val:1},{label:'L',val:1.12},{label:'XL',val:1.25}].map(o => (
            <button key={o.label} onClick={() => update({ textScale: o.val })} style={chip(tweaks.textScale === o.val)}>{o.label}</button>
          ))}
        </div>
      </Row>
      <Row label="contrast">
        <div style={{ display: 'flex', gap: 5 }}>
          {['normal','high'].map(o => (
            <button key={o} onClick={() => update({ contrast: o })} style={chip(tweaks.contrast === o)}>{o}</button>
          ))}
        </div>
      </Row>
      <Row label="accent">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {['moss','bark','clay','slate'].map(o => (
            <button key={o} onClick={() => update({ palette: o })} style={chip(tweaks.palette === o)}>{o}</button>
          ))}
        </div>
      </Row>
      <Row label={`paper grain · ${Math.round(tweaks.grain*100)}%`}>
        <input type="range" min="0" max="0.7" step="0.05"
          value={tweaks.grain}
          onChange={e => update({ grain: parseFloat(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--moss)' }}
        />
      </Row>
      <Row label="claude voice">
        <div style={{ display: 'flex', gap: 5 }}>
          <button onClick={() => update({ claudeItalic: true })} style={chip(tweaks.claudeItalic)}>italic</button>
          <button onClick={() => update({ claudeItalic: false })} style={chip(!tweaks.claudeItalic)}>upright</button>
        </div>
      </Row>
    </div>
  );
}

// ---------- Root ----------

export default function App() {
  const [screen, setScreen] = useState('start');
  const [result, setResult] = useState(null);
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  useEffect(() => {
    applyTweaks(tweaks);
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        setTweaksOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {screen === 'start' && <StartScreen onStart={() => setScreen('play')} />}
      {screen === 'play' && <PlayScreen onEnd={(r) => { setResult(r); setScreen('end'); }} />}
      {screen === 'end' && result && (
        <EndScreen
          rounds={result.rounds}
          avgResponseMs={result.avgResponseMs}
          onRestart={() => { setResult(null); setScreen('start'); }}
        />
      )}
      {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} onClose={() => setTweaksOpen(false)} />}
    </>
  );
}
