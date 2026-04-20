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

// Cheap heuristic: if the player's word is non-alphabetic garbage or shows up
// earlier in the chain, we tell the AI to pivot instead of playing off it.
function looksBrokenOrRepeat(userWord, history) {
  if (!userWord) return true;
  if (!/^[a-z][a-z'\-]*$/.test(userWord)) return true;
  return history.some(h => h.word?.toLowerCase() === userWord.toLowerCase());
}

async function claudeNextWord(history, userWord) {
  // Full chain, not just the last 10 — required so the repeat guard works.
  const chainLines = history.map(h => `${h.who === 'user' ? 'Player' : 'You'}: ${h.word}`).join('\n');
  const usedWords = Array.from(new Set(history.map(h => h.word).concat([userWord]))).filter(Boolean);
  const brokenReply = looksBrokenOrRepeat(userWord, history);

  const prompt = `You are Claude, playing Thicket — a two-minute word-association game with a human. You alternate single words, each one sparking from the last.

GOAL
Pick a word that lands in the Goldilocks zone: unexpected but clearly connected. Obvious in hindsight, not on first impulse. A listener should nod ("oh, right"), not squint ("what?"). Try to give the human ROOM — a word with only one sensible reply traps them.

THE HUMAN JUST SAID: "${userWord}"

Full chain so far (${history.length ? 'oldest first' : 'empty'}):
${chainLines || '(none yet)'}

Never reuse any word from this list:
${usedWords.length ? usedWords.join(', ') : '(none)'}

GOOD MOVES (each would score ~75–85 on the scorer's rubric)
  market   → stall      (shifts angle inside the same scene)
  hour     → second     (pun on "second" as time/rank)
  trumpet  → brass      (material, not category "instrument")
  spanner  → twist      (idiom pivot)
  chaos    → carnival   (shared feeling, different domain)
  rush     → hour       (compound-word lock-in)

AVOID (these score below 55)
  first-impulse synonyms or rhymes  (loud → noisy, bright → light)
  same-category siblings            (apple → banana, red → blue)
  nature-filler reflexes            (moss, dusk, hollow, ember, lantern, thread, whisper, drift) — unless the chain genuinely invites them
  anything a dictionary would list as the top association

REGISTER VARIETY
Don't stay in one mood. If the last few turns were concrete, go abstract. If earnest, go wry. If everyday, go specialized. Mix domains across the round (kitchen, sport, music, finance, weather, body, machines) so the chain doesn't settle into one vibe.

${brokenReply
  ? `PIVOT: the human's word doesn't give you much. Don't double down on it — pick a fresh word that opens a new direction for the chain.`
  : `Respond off "${userWord}" — the word immediately before yours is the one you're riffing on.`}

VOICE
Curious, unflashy, playful. No show-off vocabulary. No proper nouns unless the chain has already gone there.

OUTPUT
Exactly one single lowercase word. 1–3 syllables. No punctuation, no quotes, no explanation.

Your word:`;

  try {
    const text = await callClaude({ prompt, task: 'word' });
    const cleaned = (text || '').trim().toLowerCase().replace(/[^a-z'\-]/g, '').slice(0, 24);
    // Safety net: if Claude echoed a used word anyway, fall back.
    if (!cleaned || usedWords.map(w=>w.toLowerCase()).includes(cleaned)) {
      return fallbackWord(userWord, history);
    }
    return cleaned;
  } catch (e) { return fallbackWord(userWord, history); }
}

function fallbackWord(userWord, history) {
  const pool = ['moss','river','lantern','thread','hollow','ember','basket','shadow','hush','pebble','drift','thistle','amber','kettle','petal','marrow','linen','dusk','bramble','harbor'];
  const used = new Set(history.map(h => h.word).concat([userWord]));
  return pool.find(w => !used.has(w)) || 'quiet';
}

// Client-side repeat detection (independent of the LLM).
function detectRepeats(rounds, seedWord) {
  const seen = new Set();
  if (seedWord) seen.add(seedWord.toLowerCase().trim());
  const flags = rounds.map((r) => {
    const w = (r.user || '').toLowerCase().trim();
    const isRepeat = seen.has(w) && !!w;
    seen.add(w);
    if (r.claude) seen.add(r.claude.toLowerCase().trim());
    return isRepeat;
  });
  return flags;
}

// Minimal scorer: only the four things the end screen actually shows.
// goldilocksCount (how many of n hit 70+), standoutTurn (best), weakestTurn, note.
async function claudeScoreGame(rounds, avgResponseMs, seedWord) {
  const userWords = rounds.map(r => r.user).filter(Boolean);
  const n = userWords.length;
  const repeatFlags = detectRepeats(rounds, seedWord);

  const lines = [];
  let prevAi = seedWord || null;
  lines.push(`(opens with AI word: ${seedWord ? `"${seedWord}"` : '(none)'})`);
  rounds.forEach((r, i) => {
    const mark = repeatFlags[i] ? ' [REPEAT]' : '';
    lines.push(`Turn ${i+1}: AI="${prevAi || '?'}" → PLAYER="${r.user}"${mark}`);
    if (r.claude) { lines.push(`         → AI="${r.claude}"`); prevAi = r.claude; }
  });
  const transcript = lines.join('\n');

  const prompt = `Judge a word-association game round. The PLAYER word on each turn is judged against the AI word immediately before it.

Rubric (mental scoring band — never output these numbers):
  STRONG (70+):   unexpected but clearly connected — pun, idiom pivot, compound-word lock-in, register shift, material instead of category. Example: rush→hour, trumpet→brass.
  SOLID (55–69):  real association with a little reach.
  PREDICTABLE (40–54): first-impulse synonym, rhyme, or top-of-list category. Example: light→shadow, sun→warm.
  WEAK (<40):     stale reflex, repeat, nonsense.

Repeats of earlier words always score below 40.

Transcript:
${transcript}

Tasks:
1. Count how many of the ${n} PLAYER words are STRONG (70+). That count is goldilocksCount.
2. Pick the single best PLAYER reply — its 1-based turn number is standoutTurn.
3. Pick the single weakest PLAYER reply — its 1-based turn number is weakestTurn. If every word was at least SOLID, use 0.
4. Write a 2-sentence note: warm, specific, naming ONE turn by number and the word at that turn. First sentence = something the player did well. Second sentence (optional) = one concrete pattern to try next round. No generic "trust yourself" advice. No exclamation marks.

Return ONLY valid JSON — no code fences, no prose outside:
{
  "goldilocksCount": <int 0-${n}>,
  "standoutTurn": <int 1-${n}>,
  "weakestTurn": <int 0-${n}>,
  "note": "<2 sentences>"
}`;

  try {
    const text = await callClaude({ prompt, task: 'score' });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const clampTurn = (v) => {
        const i = parseInt(v);
        if (!Number.isFinite(i)) return 0;
        return Math.max(0, Math.min(n, i));
      };
      const standoutTurn = clampTurn(parsed.standoutTurn);
      const weakestTurn  = clampTurn(parsed.weakestTurn);
      const standoutIdx = standoutTurn > 0 ? standoutTurn - 1 : 0;
      const weakestIdx  = weakestTurn  > 0 ? weakestTurn  - 1 : -1;
      const goldilocksCount = Math.max(0, Math.min(n, parseInt(parsed.goldilocksCount) || 0));
      return {
        goldilocksCount,
        standoutIdx,
        standout: userWords[standoutIdx] || '',
        weakestIdx,
        weakest: weakestIdx >= 0 ? (userWords[weakestIdx] || '') : '',
        note: String(parsed.note || '').trim(),
      };
    }
  } catch(e) {}

  // Local fallback: pick a reply in the 1.5–5s sweet spot as standout.
  let bestIdx = 0;
  rounds.forEach((r, i) => {
    if (repeatFlags[i]) return;
    const s = (r.userMs || 0) / 1000;
    if (s >= 1.5 && s <= 5 && !repeatFlags[i]) bestIdx = i;
  });
  return {
    goldilocksCount: 0,
    standoutIdx: bestIdx,
    standout: userWords[bestIdx] || '',
    weakestIdx: -1,
    weakest: '',
    note: `On turn ${bestIdx+1} you landed "${userWords[bestIdx] || 'a good one'}" — follow that kind of pull next round.`,
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
      // Opener pool spans domains — kitchen, body, office, weather, sport,
      // music, travel, home — so rounds don't settle into one vibe.
      const openers = [
        'window','pocket','ladder','mirror','button','ticket','pillow','kettle',
        'rope','paper','bridge','signal','engine','bottle','map','coin',
        'shoulder','handle','needle','glove','whistle','drawer','salt','fog',
        'market','ribbon','hinge','timer',
      ];
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
        onEnd({ rounds, avgResponseMs: avg, seed });
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, rounds, onEnd]);

  const submit = useCallback(async () => {
    const word = input.trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z'\-]/g, '').slice(0, 24);
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
                onEnd({ rounds, avgResponseMs: avg, seed });
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

function EndScreen({ rounds, avgResponseMs, seed, onRestart }) {
  const [scoreData, setScoreData] = useState(null);
  const [scoring, setScoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No artificial delay — kick off the scoring call the moment the screen mounts.
      const result = await claudeScoreGame(rounds, avgResponseMs, seed);
      if (cancelled) return;
      setScoreData(result);
      setScoring(false);
    })();
    return () => { cancelled = true; };
  }, [rounds, avgResponseMs, seed]);

  // Factual stats computed client-side — show these instantly without waiting
  // for the API. Only "best leap" and "goldilocks zone" need the scorer.
  const userRounds = rounds.filter(r => r.user);
  const n = userRounds.length;
  const avgSec = (avgResponseMs/1000).toFixed(1);

  // Fastest real reply — ignore anything under 300ms (likely a typo or stray enter).
  const fastest = useMemo(() => {
    let best = null;
    userRounds.forEach(r => {
      const ms = r.userMs || 0;
      if (ms < 300) return;
      if (!best || ms < best.userMs) best = r;
    });
    return best || userRounds[0] || null;
  }, [userRounds]);

  // What was the AI word right before a given user-round?
  const prevAiFor = (target) => {
    let prev = seed;
    for (const r of rounds) {
      if (r === target) return prev;
      if (r.claude) prev = r.claude;
    }
    return prev;
  };

  const fastestPrev = fastest ? prevAiFor(fastest) : null;
  const standoutRound = scoreData && scoreData.standoutIdx >= 0
    ? userRounds[scoreData.standoutIdx] : null;
  const standoutPrev = standoutRound ? prevAiFor(standoutRound) : null;

  return (
    <div style={{
      minHeight: '100vh', overflow: 'auto',
      animation: 'fade-in 0.8s ease',
      position: 'relative',
    }}>
      <DriftLayer count={8} />
      <div style={{
        maxWidth: 820, margin: '0 auto',
        padding: 'clamp(40px, 6vw, 64px) clamp(20px, 4vw, 48px)',
        position: 'relative', zIndex: 2,
      }}>
        {/* Eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', fontWeight: 500,
          }}>
            the round — two minutes · {n} turns
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--line)', maxWidth: 200 }}/>
          <span style={{ color: 'var(--moss-soft)' }}><LeafIcon size={16} sway /></span>
        </div>

        {/* Stats grid — factual, no vague labels, no overall score */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'clamp(10px, 1.5vw, 16px)',
          marginBottom: 36,
        }}>
          <Stat
            label="avg per turn"
            value={`${avgSec}s`}
            delay={60}
          />
          <Stat
            label="fastest reply"
            value={fastest?.user || '—'}
            sub={fastest && fastestPrev ? `${(fastest.userMs/1000).toFixed(1)}s · from ${fastestPrev}` : (fastest ? `${(fastest.userMs/1000).toFixed(1)}s` : '')}
            delay={140}
          />
          <Stat
            label="best leap"
            value={scoreData?.standout || '…'}
            sub={scoreData && standoutPrev && scoreData.standout ? `${standoutPrev} → ${scoreData.standout}` : ''}
            loading={scoring}
            accent
            delay={220}
          />
          <Stat
            label="goldilocks zone"
            value={scoreData ? `${scoreData.goldilocksCount} of ${n}` : '…'}
            sub="replies that really landed"
            loading={scoring}
            delay={300}
          />
        </div>

        {/* The trail — full word journey, with the best leap pair highlighted */}
        <TrailJourney
          rounds={rounds}
          seed={seed}
          standoutIdx={scoreData?.standoutIdx ?? -1}
        />

        {/* Short feedback note */}
        <div style={{ marginBottom: 40, maxWidth: 680 }}>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <SpeakerPill who="claude" />
            <span>a short note</span>
          </div>
          <div className="serif" style={{
            fontSize: 'clamp(17px, 2vw, 20px)', lineHeight: 1.55, fontWeight: 400,
            color: 'var(--ink)',
            minHeight: 52,
            fontStyle: 'var(--claude-style, italic)',
            textWrap: 'pretty',
            paddingLeft: 16, borderLeft: '2px solid var(--claude-line)',
          }}>
            {scoring
              ? <span style={{ color: 'var(--stone)' }}>reading back through it <ThinkingDots /></span>
              : (scoreData?.note || '')}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onRestart} style={{
            background: 'var(--moss)', color: 'var(--paper)',
            border: 'none', padding: '14px 28px',
            fontFamily: 'inherit', fontSize: 16, fontWeight: 500, letterSpacing: '0.02em',
            cursor: 'pointer', borderRadius: 2,
            transition: 'background 400ms ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--moss-deep)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--moss)'}
          >
            Another round
          </button>
        </div>
      </div>
    </div>
  );
}

// Visual walk of the whole round: seed → user → claude → user → claude …
// The best-leap pair (claude word that sparked the standout reply + the
// standout reply itself) is highlighted in a soft moss pill. Each chip
// staggers in so it reads like the trail being laid down.
function TrailJourney({ rounds, seed, standoutIdx }) {
  // Build a flat list of chips with their kind and original user-index (if user).
  const items = [];
  if (seed) items.push({ word: seed, kind: 'seed' });
  let userCount = 0;
  rounds.forEach(r => {
    if (r.user) {
      items.push({ word: r.user, kind: 'user', userIdx: userCount });
      userCount++;
    }
    if (r.claude) items.push({ word: r.claude, kind: 'claude' });
  });

  const bestIdx = standoutIdx >= 0
    ? items.findIndex(it => it.kind === 'user' && it.userIdx === standoutIdx)
    : -1;
  const bestPrevIdx = bestIdx > 0 ? bestIdx - 1 : -1;

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="mono" style={{
        fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>the trail</span>
        <div style={{ flex: 1, height: 1, background: 'var(--line)', maxWidth: 160 }}/>
        {bestIdx >= 0 && (
          <span style={{ color: 'var(--moss-soft)', fontSize: 10, letterSpacing: '0.15em' }}>
            best leap highlighted
          </span>
        )}
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: '10px 10px',
        padding: '20px 22px',
        border: '1px solid var(--line)',
        background: 'rgba(255,252,241,0.4)',
        borderRadius: 3,
        lineHeight: 1.4,
      }}>
        {items.map((it, i) => {
          const highlighted = i === bestIdx || i === bestPrevIdx;
          const isClaude = it.kind === 'claude';
          const isSeed = it.kind === 'seed';
          const delay = 120 + i * 55;
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span
                className="serif"
                style={{
                  fontSize: highlighted
                    ? 'clamp(19px, 2.2vw, 23px)'
                    : 'clamp(16px, 1.8vw, 19px)',
                  fontStyle: isClaude ? 'var(--claude-style, italic)' : 'normal',
                  fontWeight: highlighted ? 500 : 400,
                  color: highlighted
                    ? 'var(--moss-deep)'
                    : (isClaude ? 'var(--claude-ink)' : (isSeed ? 'var(--stone)' : 'var(--ink)')),
                  background: highlighted ? 'rgba(122,136,100,0.22)' : 'transparent',
                  padding: highlighted ? '3px 11px' : '0',
                  borderRadius: highlighted ? 14 : 0,
                  letterSpacing: '-0.005em',
                  opacity: 0,
                  transform: 'translateY(6px)',
                  animation: `fade-in 520ms ease ${delay}ms forwards`,
                  whiteSpace: 'nowrap',
                }}
              >
                {it.word}
              </span>
              {i < items.length - 1 && (
                <span
                  className="mono"
                  style={{
                    color: 'var(--stone-2)',
                    fontSize: 12,
                    opacity: 0,
                    animation: `fade-in 520ms ease ${delay + 30}ms forwards`,
                  }}
                >
                  →
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// Single stat card. `loading` dims the value while the scorer is still running.
// `accent` gives a card a soft moss tint (used for the best-leap highlight).
// `delay` staggers the reveal animation.
function Stat({ label, value, sub, loading, accent, delay = 0 }) {
  return (
    <div style={{
      padding: '18px 20px',
      border: accent ? '1px solid var(--claude-line)' : '1px solid var(--line)',
      background: accent ? 'rgba(92,107,71,0.08)' : 'rgba(255,252,241,0.5)',
      borderRadius: 3,
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: 96,
      opacity: 0,
      transform: 'translateY(10px)',
      animation: `fade-in 600ms ease ${delay}ms forwards`,
    }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: accent ? 'var(--moss-deep)' : 'var(--stone)',
        fontWeight: 500,
      }}>
        {label}
      </div>
      <div className="serif" style={{
        fontSize: 'clamp(22px, 2.6vw, 28px)',
        color: accent ? 'var(--moss-deep)' : 'var(--ink)',
        fontWeight: 400,
        letterSpacing: '-0.01em', lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
        opacity: loading ? 0.35 : 1,
        animation: loading ? 'thinking 1.4s ease-in-out infinite' : 'none',
        transition: 'opacity 400ms ease',
        wordBreak: 'break-word',
      }}>
        {value}
      </div>
      {sub && (
        <div className="mono" style={{
          fontSize: 11, color: 'var(--stone)',
          fontVariantNumeric: 'tabular-nums',
          opacity: loading ? 0.35 : 1,
          letterSpacing: '0.02em',
        }}>
          {sub}
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
          seed={result.seed}
          onRestart={() => { setResult(null); setScreen('start'); }}
        />
      )}
      {tweaksOpen && <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} onClose={() => setTweaksOpen(false)} />}
    </>
  );
}
