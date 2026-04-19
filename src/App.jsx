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

// Deterministic quality aggregation — identical perWord always yields identical
// quality. Weak words drag more than strong words lift (below 50 is amplified),
// with a small bonus for hitting a real leap.
function aggregateQuality(perWord) {
  if (!perWord.length) return 0;
  const adjusted = perWord.map(q => q >= 50 ? q : 50 - (50 - q) * 1.6);
  const mean = adjusted.reduce((a,b) => a+b, 0) / adjusted.length;
  const peak = Math.max(...perWord);
  const peakBonus = peak >= 90 ? 3 : peak >= 80 ? 2 : peak >= 70 ? 1 : 0;
  return Math.max(0, Math.min(100, Math.round(mean + peakBonus)));
}

async function claudeScoreGame(rounds, avgResponseMs, seedWord) {
  const userWords = rounds.map(r => r.user).filter(Boolean);
  const repeatFlags = detectRepeats(rounds, seedWord);

  // Unambiguous turn-indexed transcript. Turn numbers match the output indices.
  const lines = [];
  let prevAi = seedWord || null;
  lines.push(`(game opens with AI word: ${seedWord ? `"${seedWord}"` : '(none)'})`);
  rounds.forEach((r, i) => {
    const t = ((r.userMs||0)/1000).toFixed(1);
    const repeatMark = repeatFlags[i] ? ' [REPEAT — cap 25]' : '';
    lines.push(`Turn ${i+1}: AI="${prevAi || '?'}" → PLAYER="${r.user}" (${t}s)${repeatMark}`);
    if (r.claude) {
      lines.push(`         → AI reply="${r.claude}"`);
      prevAi = r.claude;
    }
  });
  const transcript = lines.join('\n');

  const n = userWords.length;
  const prompt = `You are the judge for Thicket, a word-association game. You score each PLAYER word on how well it responded to the AI word immediately before it.

WHO SAID WHAT
"AI=..." is a word the AI said — these are SETUPS, not judged.
"PLAYER=..." is what the human said in response — these are what you score.

Transcript (turn-indexed; use these turn numbers in your output):
${transcript}

—— RUBRIC ————————————————————————————————————————

For each PLAYER word, ask: how would a thoughtful, non-expert listener react?

90–100  BRILLIANT    Reframes the chain. Pun on a second sense; register jump (concrete↔abstract) that still connects; idiom pivot. Rare — maybe 1 per round.
                     hour → second     (second as "second wind")
                     rush → hour       (compound-word lock-in)
                     chaos → carnival  (same feeling, different domain)

75–89   STRONG       Unexpected but clearly connected. Obvious in hindsight, not on first impulse.
                     potato → chip     (compound, not category)
                     spanner → twist   (idiom)
                     trumpet → brass   (material, not category "instrument")

60–74   SOLID        A real association with a little reach. Not the first word most people would say, but adjacent to it.
                     cigar → smoke
                     river → stone

45–59   PREDICTABLE  The first link most listeners would name: synonym, rhyme, top-of-list category.
                     light → shadow
                     sun → warm
                     loud → music

25–44   WEAK         Rote reflex or stale pairing with no angle.
                     sheep → wool
                     trumpet → music

0–24    BROKEN       Unrelated, nonsense, non-word input, or REPEATED from earlier.

—— BONUSES (apply to base score BEFORE caps) ————————————

+5  Took <2s and base is 75+ (instinct reward).
+3  Word visibly sets up a richer next AI turn.

Do NOT penalize slow replies. A pause often means the player was working to avoid the obvious — don't punish that.

—— CAPS (apply AFTER bonuses) —————————————————————————

Marked [REPEAT]:                       cap 25.
Non-word / typo / emoji / multi-word:  cap 20.
Link requires the player to explain it
for a listener to accept:              cap 60.

—— DIFFICULTY OF THE AI SETUP ——————————————————————————

If the AI's preceding word is itself narrow (only 2–3 reasonable replies exist), do not score a predictable player reply below 55 — they took the only road available. Note this in the reason: "AI's setup left little room."

—— SCORE WHAT'S THERE ——————————————————————————————————

Score each word in isolation, using ONLY the AI word immediately before it. Do not compound-punish a run of mediocre replies. Do not fabricate variance: if the round was genuinely steady, a flat curve of 60s is the correct answer. If one word is a true leap, score it 85+ even if the rest are 55s.

—— REASONS ————————————————————————————————————————————

For each PLAYER word, write a reason up to 12 words, second person, naming WHAT the player did. Useful reasons:
  "first synonym that comes to mind — safe move"
  "pun on 'second' as time — real leap"
  "AI's setup was narrow; reasonable pick"
  "category jump with no connective tissue — lands flat"
  "couldn't parse as a word"

Avoid generic ("nice", "okay", "bold"). Name the move.

—— STANDOUT / WEAKEST USE TURN NUMBERS ——————————————————

standoutTurn: 1-based turn number of the single best PLAYER reply.
weakestTurn:  1-based turn number of the weakest. 0 if every word scored 65+.
weakestAlt:   one single word that would have scored 75+ from the same AI prompt, or empty.

—— COACHING NOTE ———————————————————————————————————————

1–2 sentences, warm and specific.
  First sentence: name ONE concrete thing the player did well, referring to what happened at a specific turn (e.g., "On turn 4 you jumped from 'rush' to 'hour' — exactly the compound-word pivot the game rewards.").
  Second sentence (optional): ONE pattern to try next round, concrete and actionable (e.g., "When an AI word has two meanings, try the less-obvious one first.").
No exclamation marks. No generic "trust yourself" advice.

—— OUTPUT ——————————————————————————————————————————————

Return ONLY valid JSON — no code fences, no prose outside the object:
{
  "perWord": [<int 0-100, exactly ${n} numbers, in order>],
  "reasons": [<string, exactly ${n} phrases, in order, ≤12 words each>],
  "standoutTurn": <int 1-${n}>,
  "standoutWhy": "<one short phrase, ≤10 words>",
  "weakestTurn": <int 0-${n}>,
  "weakestAlt": "<one word, or empty>",
  "note": "<1–2 sentences following the COACHING NOTE rules>"
}`;

  try {
    const text = await callClaude({ prompt, task: 'score' });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);

      let perWord = Array.isArray(parsed.perWord)
        ? parsed.perWord.map(v => Math.max(0, Math.min(100, parseInt(v) || 50)))
        : [];
      while (perWord.length < n) perWord.push(50);
      perWord = perWord.slice(0, n);
      // Repeat cap is the law — enforce client-side too.
      perWord = perWord.map((q, i) => repeatFlags[i] ? Math.min(q, 25) : q);

      let reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.map(r => String(r || '').trim())
        : [];
      while (reasons.length < n) reasons.push('');
      reasons = reasons.slice(0, n);

      const clampTurn = (v) => {
        const i = parseInt(v);
        if (!Number.isFinite(i)) return 0;
        return Math.max(0, Math.min(n, i));
      };
      const standoutTurn = clampTurn(parsed.standoutTurn);
      const weakestTurn  = clampTurn(parsed.weakestTurn);

      const standoutIdx = standoutTurn > 0 ? standoutTurn - 1 : perWord.indexOf(Math.max(...perWord));
      const weakestIdx  = weakestTurn  > 0 ? weakestTurn  - 1 : -1;

      return {
        quality: aggregateQuality(perWord), // deterministic
        perWord,
        reasons,
        standoutIdx,
        standout: userWords[standoutIdx] || '',
        standoutWhy: String(parsed.standoutWhy || '').trim(),
        weakestIdx,
        weakest: weakestIdx >= 0 ? (userWords[weakestIdx] || '') : '',
        weakestAlt: String(parsed.weakestAlt || '').toLowerCase().trim(),
        note: String(parsed.note || '').trim(),
        repeatFlags,
      };
    }
  } catch(e) {}

  // Local fallback if the API or parse failed. Maps response time to a band
  // with minimal fabricated variance (±6 instead of ±14).
  const perWord = rounds.map((r, i) => {
    if (repeatFlags[i]) return 22;
    const s = (r.userMs || 3000) / 1000;
    let base;
    if (s < 1.2) base = 52;
    else if (s < 2.5) base = 62;
    else if (s < 5) base = 64;
    else if (s < 9) base = 60;
    else base = 56;
    return base + Math.round((Math.random() - 0.5) * 6);
  }).map(n => Math.max(0, Math.min(100, n)));

  const maxIdx = perWord.indexOf(Math.max(...perWord));
  const minIdx = perWord.indexOf(Math.min(...perWord));
  return {
    quality: aggregateQuality(perWord),
    perWord,
    reasons: perWord.map(q => q >= 70 ? 'felt earned' : q >= 55 ? 'solid link' : 'first-impulse pick'),
    standoutIdx: maxIdx,
    standout: userWords[maxIdx] || '',
    standoutWhy: 'the one that turned a corner',
    weakestIdx: perWord[minIdx] < 55 ? minIdx : -1,
    weakest: perWord[minIdx] < 55 ? (userWords[minIdx] || '') : '',
    weakestAlt: '',
    note: `On turn ${maxIdx+1} you landed "${userWords[maxIdx] || 'a good one'}" — that's the kind of reach the game rewards. Next round, when an AI word has two meanings, try the less-obvious sense first.`,
    repeatFlags,
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
  const [scoring, setScoring] = useState(true);
  const [scoreData, setScoreData] = useState(null);
  const [quality, setQuality] = useState(0);
  const [typed, setTyped] = useState('');
  const [activeIdx, setActiveIdx] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [shareState, setShareState] = useState('idle'); // idle | copied | failed
  const savedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise(r => setTimeout(r, 900));
      const result = await claudeScoreGame(rounds, avgResponseMs, seed);
      if (cancelled) return;
      setScoreData(result);
      setScoring(false);
      // Save the run once, so StrictMode double-invokes don't double-log.
      if (!savedRef.current) {
        savedRef.current = true;
        const entry = {
          t: Date.now(),
          quality: result.quality,
          turns: rounds.filter(r => r.claude).length,
          avgMs: avgResponseMs,
        };
        setHistory(saveHistoryEntry(entry));
      }
      // Animate the score count-up.
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
  }, [rounds, avgResponseMs, seed]);

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
    }, 1600);
    return () => clearTimeout(startDelay);
  }, [note]);

  const turnsCompleted = rounds.filter(r => r.claude).length;
  const avgSec = (avgResponseMs/1000).toFixed(1);
  const band = scoreData ? scoreBand(scoreData.quality) : null;

  // Delta vs. the previous run, and personal best flag.
  // history[last] is the just-saved current run, so previous is [last-1].
  const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
  const delta = scoreData && prevEntry ? scoreData.quality - prevEntry.quality : null;
  const best = scoreData && history.length
    ? history.reduce((m, h) => h.quality > m ? h.quality : m, 0)
    : null;
  const isBest = scoreData && best !== null && scoreData.quality >= best && history.length > 1;

  const userTurns = useMemo(() => buildUserTurns({
    rounds,
    perWord: scoreData?.perWord || [],
    reasons: scoreData?.reasons || [],
    seed,
    repeatFlags: scoreData?.repeatFlags || [],
    standoutIdx: typeof scoreData?.standoutIdx === 'number' ? scoreData.standoutIdx : -1,
    weakestIdx:  typeof scoreData?.weakestIdx  === 'number' ? scoreData.weakestIdx  : -1,
  }), [rounds, scoreData, seed]);

  const longestPause = userTurns.reduce((b, t) => !b || t.timeMs > b.timeMs ? t : b, null);

  const handleShare = async () => {
    const text = buildShareText({ rounds, seed, scoreData, avgResponseMs });
    const ok = await copyToClipboard(text);
    setShareState(ok ? 'copied' : 'failed');
    setTimeout(() => setShareState('idle'), 1800);
  };

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
        {/* Eyebrow */}
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

        {/* Verdict-first headline */}
        <h2 className="serif" style={{
          fontSize: 'clamp(36px, 5.5vw, 56px)',
          fontWeight: 400, fontStyle: 'italic',
          lineHeight: 1.05, letterSpacing: '-0.02em',
          color: band ? band.tone : 'var(--ink)',
          margin: '0 0 18px',
          maxWidth: 780, textWrap: 'pretty',
          transition: 'color 800ms ease',
        }}>
          {scoring ? 'Reading back through the trail' : (band?.headline || 'Here is what the trail looked like')}
          <span style={{ color: 'var(--moss)' }}>.</span>
        </h2>

        {/* Score row with band, delta, and best marker */}
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 24, flexWrap: 'wrap',
          marginBottom: 40, paddingBottom: 28, borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="serif" style={{
              fontSize: 'clamp(72px, 9vw, 104px)',
              fontWeight: 400, letterSpacing: '-0.04em', lineHeight: 0.9,
              color: band?.tone || 'var(--ink)',
              fontVariantNumeric: 'tabular-nums',
              animation: scoring ? 'thinking 1.4s ease-in-out infinite' : 'none',
            }}>
              {scoring ? '—' : quality}
            </span>
            <span className="mono" style={{
              fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'var(--stone)', fontWeight: 500,
            }}>/ 100</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {band && (
              <span className="mono" style={{
                fontSize: 11, color: band.tone, letterSpacing: '0.22em',
                textTransform: 'uppercase', fontWeight: 600,
              }}>
                {band.label}
              </span>
            )}
            <div className="mono" style={{
              fontSize: 11, color: 'var(--stone)', letterSpacing: '0.14em',
              fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 14,
              flexWrap: 'wrap', textTransform: 'uppercase',
            }}>
              <span>{turnsCompleted} turns</span>
              <span>avg {avgSec}s · {timeHint(parseFloat(avgSec))}</span>
              {delta !== null && (
                <span style={{
                  color: delta > 0 ? 'var(--moss-deep)' : delta < 0 ? 'var(--clay)' : 'var(--stone)',
                  fontWeight: 600,
                }}>
                  {delta > 0 ? '+' : ''}{delta} vs last
                </span>
              )}
              {isBest && (
                <span style={{ color: 'var(--moss-deep)', fontWeight: 600 }}>new best</span>
              )}
            </div>
          </div>
        </div>

        {/* Standout callout */}
        {!scoring && userTurns.some(t => t.isStandout) && (
          <div style={{ marginBottom: 32 }}>
            <StandoutCallout
              standoutWhy={scoreData?.standoutWhy}
              userTurns={userTurns}
            />
          </div>
        )}

        {/* Coaching note */}
        <div style={{ marginBottom: 36, maxWidth: 740 }}>
          <div className="mono" style={{
            fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <SpeakerPill who="claude" />
            <span>a note for you</span>
          </div>
          <div className="serif" style={{
            fontSize: 'clamp(18px, 2.2vw, 22px)', lineHeight: 1.5, fontWeight: 400,
            color: 'var(--ink)',
            minHeight: 64,
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

        {/* Actions */}
        <div style={{ marginBottom: 48, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <button onClick={handleShare} disabled={scoring} style={{
            background: 'transparent', color: 'var(--ink-soft)',
            border: '1px solid var(--line)',
            padding: '13px 22px',
            fontFamily: 'inherit', fontSize: 15, fontWeight: 500, letterSpacing: '0.02em',
            cursor: scoring ? 'default' : 'pointer', borderRadius: 2,
            opacity: scoring ? 0.4 : 1,
            transition: 'color 300ms ease, border-color 300ms ease',
          }}>
            {shareState === 'copied' ? 'copied ✓' : shareState === 'failed' ? 'copy failed' : 'Share trail'}
          </button>
        </div>

        {/* Arc chart */}
        {!scoring && userTurns.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div className="mono" style={{
              fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
            }}>
              the arc · two minutes
            </div>
            <ArcChart
              userTurns={userTurns}
              seed={seed}
              activeIdx={activeIdx}
              setActiveIdx={setActiveIdx}
              longestPause={longestPause}
            />
          </div>
        )}

        {/* Time vs. quality */}
        {!scoring && userTurns.length >= 3 && (
          <div style={{ marginBottom: 40 }}>
            <TimeQualityScatter userTurns={userTurns} />
          </div>
        )}

        {/* Exchange cards */}
        {!scoring && userTurns.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div className="mono" style={{
              fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'var(--stone)', marginBottom: 14, fontWeight: 500,
            }}>
              the exchange
            </div>
            <ExchangeCards
              userTurns={userTurns}
              activeIdx={activeIdx}
              setActiveIdx={setActiveIdx}
            />
            {scoreData?.weakest && scoreData?.weakestAlt && (
              <div className="serif" style={{
                marginTop: 14, fontSize: 14, fontStyle: 'italic',
                color: 'var(--stone)', paddingLeft: 12,
                borderLeft: '2px solid var(--line)',
              }}>
                instead of <strong style={{ color: 'var(--clay)' }}>{scoreData.weakest}</strong>, you could have tried <strong style={{ color: 'var(--moss-deep)' }}>{scoreData.weakestAlt}</strong>.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function qualityColor(q) {
  if (q >= 78) return 'var(--moss-deep)';
  if (q >= 60) return 'var(--moss)';
  if (q >= 45) return 'var(--stone)';
  return 'var(--clay)';
}

// Maps a score to its rubric band label. Keeps copy honest — a 58
// is not "the goldilocks zone", it's just below it.
function scoreBand(q) {
  if (q >= 85) return { label: 'brilliant', headline: 'You found the clearing.', tone: 'var(--moss-deep)' };
  if (q >= 70) return { label: 'strong',    headline: 'You hit the Goldilocks zone.', tone: 'var(--moss-deep)' };
  if (q >= 55) return { label: 'solid',     headline: 'You kept it solid.', tone: 'var(--moss)' };
  if (q >= 40) return { label: 'first-path',headline: 'You took the first path most times.', tone: 'var(--stone)' };
  return { label: 'rough', headline: 'A shaky round — plenty to climb next time.', tone: 'var(--clay)' };
}

// Label for a single score reflecting the rubric bands (not just a comparison).
function wordBandLabel(q) {
  if (q >= 90) return 'brilliant';
  if (q >= 75) return 'strong';
  if (q >= 60) return 'solid';
  if (q >= 45) return 'predictable';
  if (q >= 25) return 'weak';
  return 'broken';
}

// Score history lives in localStorage. We only keep the last 20 runs.
const HISTORY_KEY = 'thicket:history:v1';
function loadHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(e => e && typeof e.quality === 'number') : [];
  } catch { return []; }
}
function saveHistoryEntry(entry) {
  if (typeof window === 'undefined') return [];
  try {
    const hist = loadHistory();
    hist.push(entry);
    const trimmed = hist.slice(-20);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch { return []; }
}

// Pearson correlation between two arrays (same length).
function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx, ay = ys[i] - my;
    num += ax * ay; dx += ax * ax; dy += ay * ay;
  }
  const denom = Math.sqrt(dx * dy);
  return denom ? num / denom : 0;
}

// Turn the correlation between time-taken and quality into a human sentence.
function timeQualityInsight(r) {
  if (Math.abs(r) < 0.2) return 'Taking longer didn\'t change much — instinct was about as good as deliberation.';
  if (r > 0.5)  return 'The extra seconds clearly paid off — your slower words scored noticeably higher.';
  if (r > 0.2)  return 'Slower answers scored a little better — deliberation helped, modestly.';
  if (r < -0.5) return 'Your quickest answers were your strongest — overthinking seemed to hurt.';
  return 'Faster answers scored a little better — your first instincts were onto something.';
}

// Clipboard helper with a tiny visible confirmation state.
async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function buildShareText({ rounds, seed, scoreData, avgResponseMs }) {
  const lines = [];
  lines.push(`Thicket — word association`);
  lines.push(`quality ${scoreData?.quality ?? '—'}/100 · ${rounds.length} turns · avg ${(avgResponseMs/1000).toFixed(1)}s`);
  lines.push('');
  const trail = [];
  if (seed) trail.push(seed);
  rounds.forEach(r => {
    if (r.user) trail.push(r.user);
    if (r.claude) trail.push(r.claude);
  });
  lines.push(trail.join(' → '));
  if (scoreData?.standout) lines.push('');
  if (scoreData?.standout) lines.push(`best leap: ${scoreData.standout}${scoreData.standoutWhy ? ` — ${scoreData.standoutWhy}` : ''}`);
  return lines.join('\n');
}

// Build a unified per-user-turn array with everything downstream
// components need. userTurns[0].prevAi is the seed (the AI's opener).
function buildUserTurns({ rounds, perWord, reasons, seed, repeatFlags, standoutIdx, weakestIdx }) {
  const out = [];
  let prevAi = seed || null;
  rounds.forEach((r) => {
    if (!r.user) return;
    const idx = out.length;
    out.push({
      idx,
      word: r.user,
      prevAi,
      claudeReply: r.claude || null,
      quality: typeof perWord?.[idx] === 'number' ? perWord[idx] : 55,
      reason: reasons?.[idx] || '',
      timeMs: r.userMs || 0,
      atMs: typeof r.userAt === 'number' ? r.userAt : 0,
      claudeAt: typeof r.claudeAt === 'number' ? r.claudeAt : null,
      isRepeat: !!repeatFlags?.[idx],
      isStandout: idx === standoutIdx,
      isWeakest: idx === weakestIdx,
    });
    if (r.claude) prevAi = r.claude;
  });
  return out;
}

// Featured moment — the standout leap, shown prominently above the chart.
function StandoutCallout({ standoutWhy, userTurns }) {
  const match = userTurns.find(t => t.isStandout);
  if (!match) return null;
  return (
    <div style={{
      padding: 'clamp(20px, 2.6vw, 28px)',
      background: 'var(--moss-soft)',
      border: '1px solid var(--moss-soft)',
      borderRadius: 4,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'var(--moss-deep)', fontWeight: 500, marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <LeafIcon size={12} color="var(--moss-deep)" sway /> best leap
      </div>
      <div className="serif" style={{
        fontSize: 'clamp(22px, 3vw, 30px)', lineHeight: 1.25, fontWeight: 400,
        color: 'var(--ink)', letterSpacing: '-0.015em', marginBottom: 10,
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        {match.prevAi && (
          <span style={{ color: 'var(--claude-ink)', fontStyle: 'italic' }}>
            {match.prevAi}
          </span>
        )}
        {match.prevAi && <span style={{ color: 'var(--stone)' }}>→</span>}
        <span style={{ color: 'var(--moss-deep)', fontWeight: 500 }}>{match.word}</span>
        <span className="mono" style={{
          fontSize: 12, color: 'var(--moss-deep)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          q{match.quality}
        </span>
      </div>
      {standoutWhy && (
        <div className="serif" style={{
          fontSize: 16, fontStyle: 'italic', color: 'var(--ink-soft)',
          lineHeight: 1.45, maxWidth: 620,
        }}>
          {standoutWhy}
        </div>
      )}
    </div>
  );
}

// The arc — quality over time, with linked hover/focus state.
function ArcChart({ userTurns, seed, activeIdx, setActiveIdx, longestPause }) {
  const totalMs = GAME_SECONDS * 1000;
  const maxTimeMs = Math.max(3000, ...userTurns.map(t => t.timeMs));

  const W = 1000;
  const qualityH = 170;
  const axisY = qualityH;
  const timeH = 58;
  const H = qualityH + timeH + 36;
  const PAD_L = 34, PAD_R = 20;
  const plotW = W - PAD_L - PAD_R;

  const xAt = (ms) => PAD_L + (plotW * Math.min(Math.max(ms, 0), totalMs)) / totalMs;
  const qualityY = (q) => 10 + (qualityH - 22) * (1 - q / 100);
  // Sqrt scale so short pauses remain visible.
  const timeBarH = (ms) => {
    if (ms <= 0) return 1;
    const s = Math.sqrt(ms / maxTimeMs);
    return Math.max(2, s * (timeH - 12));
  };

  let pathD = '';
  userTurns.forEach((t, i) => {
    pathD += `${i === 0 ? 'M' : 'L'} ${xAt(t.atMs).toFixed(1)} ${qualityY(t.quality).toFixed(1)} `;
  });
  const areaD = userTurns.length
    ? `${pathD} L ${xAt(userTurns[userTurns.length-1].atMs).toFixed(1)} ${axisY} L ${xAt(userTurns[0].atMs).toFixed(1)} ${axisY} Z`
    : '';

  const active = typeof activeIdx === 'number' ? userTurns[activeIdx] : null;

  // Claude's words to label above the axis (including the seed at t=0).
  const claudeWords = [];
  if (seed) claudeWords.push({ word: seed, atMs: 0, isSeed: true });
  userTurns.forEach(t => {
    if (t.claudeReply && typeof t.claudeAt === 'number') {
      claudeWords.push({ word: t.claudeReply, atMs: t.claudeAt });
    }
  });

  return (
    <div style={{
      padding: 'clamp(20px, 2.4vw, 28px)',
      background: 'rgba(255,252,241,0.5)',
      border: '1px solid var(--line)',
      borderRadius: 3,
    }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 18, height: 2, background: 'var(--moss)' }}/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500 }}>quality</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 12, background: 'var(--user-line)', borderRadius: 1 }}/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500 }}>seconds (√-scaled)</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 10, background: 'var(--moss-soft)', opacity: 0.6 }}/>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--stone)', fontWeight: 500 }}>goldilocks 70–89</span>
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}
          role="img" aria-label="Quality of each word over the two minutes">
          {/* Quality gridlines */}
          {[0, 25, 50, 75, 100].map(q => (
            <g key={q}>
              <line x1={PAD_L} y1={qualityY(q)} x2={W - PAD_R} y2={qualityY(q)}
                stroke="var(--line-soft)" strokeWidth="1"
                strokeDasharray={q === 0 || q === 100 ? '0' : '2 5'}
                opacity={q === 0 ? 0.6 : 0.35}/>
              <text x={PAD_L - 6} y={qualityY(q) + 3} fontSize="10"
                fill="var(--stone)" textAnchor="end"
                fontFamily="Geist Mono, ui-monospace, monospace"
                fontVariantNumeric="tabular-nums">{q}</text>
            </g>
          ))}

          {/* Goldilocks band — 70-89, matching the rubric's STRONG band. */}
          <rect x={PAD_L} y={qualityY(89)} width={plotW} height={qualityY(70) - qualityY(89)}
            fill="var(--moss-soft)" opacity="0.18"/>

          {/* Axis */}
          <line x1={PAD_L} y1={axisY} x2={W - PAD_R} y2={axisY}
            stroke="var(--line)" strokeWidth="1"/>

          {/* Time axis marks */}
          {[0, 30, 60, 90, 120].map(s => {
            const x = xAt(s * 1000);
            return (
              <g key={s}>
                <line x1={x} y1={4} x2={x} y2={axisY + timeH}
                  stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="1 5" opacity="0.45"/>
                <line x1={x} y1={axisY - 3} x2={x} y2={axisY + 3}
                  stroke="var(--line)" strokeWidth="1"/>
                <text x={x} y={H - 6} fontSize="10"
                  fill="var(--stone)" textAnchor="middle"
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fontVariantNumeric="tabular-nums">
                  {Math.floor(s/60)}:{String(s%60).padStart(2,'0')}
                </text>
              </g>
            );
          })}

          {/* Quality area + line */}
          {areaD && <path d={areaD} fill="var(--moss-soft)" opacity="0.22"/>}
          {pathD && <path d={pathD} fill="none" stroke="var(--moss)" strokeWidth="1.6"
            strokeLinejoin="round" strokeLinecap="round" opacity="0.82"/>}

          {/* Time bars under axis (sqrt scaled) */}
          {userTurns.map((t, i) => {
            const x = xAt(t.atMs);
            const h = timeBarH(t.timeMs);
            const isLongest = longestPause && longestPause.idx === t.idx;
            return (
              <rect key={`tb-${i}`}
                x={x - 2.4} y={axisY + 1} width="4.8" height={h}
                fill={isLongest ? 'var(--clay)' : 'var(--user-line)'}
                opacity={isLongest ? 0.95 : 0.55}
                rx="1.5"/>
            );
          })}
          {longestPause && (
            <text x={xAt(longestPause.atMs)} y={axisY + timeBarH(longestPause.timeMs) + 11}
              fontSize="10" fill="var(--clay)" textAnchor="middle"
              fontFamily="Geist Mono, ui-monospace, monospace"
              fontVariantNumeric="tabular-nums" fontWeight="500">
              {(longestPause.timeMs/1000).toFixed(1)}s
            </text>
          )}

          {/* Claude reply labels above axis */}
          {claudeWords.map((c, i) => {
            const x = xAt(c.atMs);
            return (
              <g key={`cw-${i}`}>
                <circle cx={x} cy={axisY} r="2.6"
                  fill="var(--paper)" stroke="var(--claude-line)" strokeWidth="1.2"/>
                <text x={x} y={axisY - 6} fontSize="10"
                  fill="var(--claude-ink)" textAnchor="middle" fontStyle="italic"
                  fontFamily="Lora, Georgia, serif" opacity="0.62">
                  {c.word}
                </text>
              </g>
            );
          })}

          {/* User word dots + connectors */}
          {userTurns.map((t, i) => {
            const x = xAt(t.atMs);
            const y = qualityY(t.quality);
            const isStandout = t.isStandout;
            const isWeakest = t.isWeakest;
            const isActive = activeIdx === i;
            const r = isActive ? 7 : (isStandout || isWeakest ? 5.4 : 4);
            const color = qualityColor(t.quality);
            return (
              <g key={`u-${i}`}>
                <line x1={x} y1={axisY} x2={x} y2={y}
                  stroke={color} strokeWidth="1" opacity={isActive ? 0.45 : 0.22}/>
                <circle cx={x} cy={y} r={r}
                  fill="var(--paper)" stroke={color} strokeWidth="1.7"/>
                <circle cx={x} cy={y} r={Math.max(1.5, r - 2)}
                  fill={color} opacity={isStandout ? 1 : 0.82}/>
                {t.isRepeat && (
                  <circle cx={x} cy={y} r={r + 3} fill="none"
                    stroke="var(--clay)" strokeWidth="1" strokeDasharray="2 2" opacity="0.7"/>
                )}
                <circle cx={x} cy={y} r="16"
                  fill="transparent"
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseLeave={() => setActiveIdx(null)}
                  onClick={() => setActiveIdx(activeIdx === i ? null : i)}
                  onFocus={() => setActiveIdx(i)}
                  onBlur={() => setActiveIdx(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Turn ${i+1}: ${t.word}, quality ${t.quality}, took ${(t.timeMs/1000).toFixed(1)} seconds`}
                  style={{ cursor: 'pointer', outline: 'none' }}/>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {active && (() => {
          const xPct = (xAt(active.atMs) / W) * 100;
          const isRight = xPct > 68;
          return (
            <div style={{
              position: 'absolute',
              left: `${xPct}%`, top: 0,
              transform: `translateX(${isRight ? '-100%' : '0'})`,
              marginLeft: isRight ? -12 : 12, marginTop: 8,
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              padding: '10px 13px',
              borderRadius: 3,
              minWidth: 200, maxWidth: 260,
              boxShadow: '0 8px 24px -12px rgba(42,39,32,0.3)',
              zIndex: 20,
              pointerEvents: 'none',
            }}>
              <div className="mono" style={{
                fontSize: 9, color: 'var(--stone)', letterSpacing: '0.14em',
                textTransform: 'uppercase', fontWeight: 500, marginBottom: 6,
              }}>
                turn {active.idx + 1} · {wordBandLabel(active.quality)}
              </div>
              {active.prevAi && (
                <div className="serif" style={{
                  fontSize: 13, color: 'var(--claude-ink)', fontStyle: 'italic',
                  marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <LeafIcon size={10} color="var(--claude-ink)"/> {active.prevAi}
                </div>
              )}
              <div className="serif" style={{
                fontSize: 22, color: 'var(--ink)', fontWeight: 400,
                lineHeight: 1.1, marginBottom: 6,
              }}>{active.word}</div>
              <div className="mono" style={{
                fontSize: 10, color: 'var(--stone)', letterSpacing: '0.08em',
                fontVariantNumeric: 'tabular-nums',
                display: 'flex', gap: 10, flexWrap: 'wrap',
                marginBottom: active.reason ? 6 : 0,
              }}>
                <span>{(active.timeMs/1000).toFixed(1)}s</span>
                <span style={{ color: qualityColor(active.quality), fontWeight: 500 }}>q{active.quality}</span>
                {active.isRepeat && <span style={{ color: 'var(--clay)' }}>repeat</span>}
              </div>
              {active.reason && (
                <div className="serif" style={{
                  fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)',
                  lineHeight: 1.35,
                }}>
                  {active.reason}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Compact scatter showing time-vs-quality and the resulting insight.
function TimeQualityScatter({ userTurns }) {
  if (userTurns.length < 3) return null;
  const xs = userTurns.map(t => t.timeMs/1000);
  const ys = userTurns.map(t => t.quality);
  const r = correlation(xs, ys);
  const insight = timeQualityInsight(r);

  const W = 520, H = 180;
  const PAD_L = 32, PAD_R = 14, PAD_T = 10, PAD_B = 28;
  const maxX = Math.max(6, ...xs);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xAt = (s) => PAD_L + (plotW * s) / maxX;
  const yAt = (q) => PAD_T + plotH * (1 - q/100);

  // Least-squares trendline.
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0)/n;
  const my = ys.reduce((a,b)=>a+b,0)/n;
  let num = 0, den = 0;
  xs.forEach((x,i) => { num += (x-mx)*(ys[i]-my); den += (x-mx)*(x-mx); });
  const slope = den ? num/den : 0;
  const intercept = my - slope*mx;
  const y0 = Math.max(0, Math.min(100, intercept));
  const yM = Math.max(0, Math.min(100, slope*maxX + intercept));

  return (
    <div style={{
      padding: 'clamp(20px, 2.4vw, 28px)',
      background: 'rgba(255,252,241,0.5)',
      border: '1px solid var(--line)',
      borderRadius: 3,
    }}>
      <div className="mono" style={{
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'var(--stone)', fontWeight: 500, marginBottom: 14,
      }}>
        time vs. quality
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.2fr) minmax(220px, 1fr)', gap: 24, alignItems: 'center' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%"
          role="img" aria-label={`Scatter of quality vs seconds. Correlation ${r.toFixed(2)}`}>
          <line x1={PAD_L} y1={H-PAD_B} x2={W-PAD_R} y2={H-PAD_B} stroke="var(--line)" strokeWidth="1"/>
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H-PAD_B} stroke="var(--line)" strokeWidth="1"/>
          {[0,50,100].map(q => (
            <g key={q}>
              <line x1={PAD_L-3} y1={yAt(q)} x2={PAD_L} y2={yAt(q)} stroke="var(--line)" strokeWidth="1"/>
              <text x={PAD_L-6} y={yAt(q)+3} fontSize="9" textAnchor="end"
                fill="var(--stone)" fontFamily="Geist Mono, ui-monospace, monospace"
                fontVariantNumeric="tabular-nums">{q}</text>
            </g>
          ))}
          {[0, Math.round(maxX/2), Math.round(maxX)].map(s => (
            <g key={s}>
              <line x1={xAt(s)} y1={H-PAD_B} x2={xAt(s)} y2={H-PAD_B+3} stroke="var(--line)" strokeWidth="1"/>
              <text x={xAt(s)} y={H-PAD_B+14} fontSize="9" textAnchor="middle"
                fill="var(--stone)" fontFamily="Geist Mono, ui-monospace, monospace"
                fontVariantNumeric="tabular-nums">{s}s</text>
            </g>
          ))}
          {Math.abs(r) >= 0.2 && (
            <line x1={xAt(0)} y1={yAt(y0)} x2={xAt(maxX)} y2={yAt(yM)}
              stroke="var(--moss-deep)" strokeWidth="1.3" opacity="0.55" strokeDasharray="3 3"/>
          )}
          {userTurns.map((t, i) => (
            <circle key={i} cx={xAt(t.timeMs/1000)} cy={yAt(t.quality)} r="3.4"
              fill={qualityColor(t.quality)} opacity="0.85"/>
          ))}
        </svg>
        <div>
          <div className="serif" style={{
            fontSize: 16, lineHeight: 1.5, color: 'var(--ink)', fontStyle: 'italic',
            marginBottom: 8,
          }}>
            {insight}
          </div>
          <div className="mono" style={{
            fontSize: 10, color: 'var(--stone)', letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}>
            correlation <span style={{ fontVariantNumeric: 'tabular-nums', marginLeft: 4 }}>r = {r.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chronological single-column cards. Shares activeIdx with the arc chart.
function ExchangeCards({ userTurns, activeIdx, setActiveIdx }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {userTurns.map((t, i) => {
        const isStandout = t.isStandout;
        const isWeakest = t.isWeakest;
        const isActive = activeIdx === i;
        const bandColor = qualityColor(t.quality);
        return (
          <div key={i}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseLeave={() => setActiveIdx(null)}
            onClick={() => setActiveIdx(isActive ? null : i)}
            style={{
              padding: '14px 16px',
              background: isActive ? 'var(--paper)' : 'rgba(255,252,241,0.5)',
              border: `1px solid ${isActive ? bandColor : 'var(--line)'}`,
              borderLeft: `3px solid ${bandColor}`,
              borderRadius: 3,
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              alignItems: 'center',
              gap: 14,
              cursor: 'pointer',
              transition: 'border-color 200ms ease, background 200ms ease',
            }}>
            <span className="mono" style={{
              fontSize: 10, color: 'var(--stone)', fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {String(i+1).padStart(2,'0')}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                {t.prevAi && (
                  <span className="serif" style={{
                    fontSize: 15, color: 'var(--claude-ink)',
                    fontStyle: 'italic', opacity: 0.85,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                    <LeafIcon size={10} color="var(--claude-ink)"/> {t.prevAi}
                  </span>
                )}
                {t.prevAi && <span style={{ color: 'var(--stone)', fontSize: 13 }}>→</span>}
                <span className="serif" style={{
                  fontSize: 19, color: 'var(--ink)', fontWeight: 400,
                  letterSpacing: '-0.01em',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  <SeedIcon size={10} color="var(--user-ink)"/> {t.word}
                </span>
                {isStandout && (
                  <span className="mono" style={{
                    fontSize: 9, color: 'var(--moss-deep)', letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}>standout</span>
                )}
                {isWeakest && !isStandout && (
                  <span className="mono" style={{
                    fontSize: 9, color: 'var(--clay)', letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}>weakest</span>
                )}
                {t.isRepeat && (
                  <span className="mono" style={{
                    fontSize: 9, color: 'var(--clay)', letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}>repeat</span>
                )}
              </div>
              {t.reason && (
                <div className="serif" style={{
                  fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)',
                  marginTop: 4, lineHeight: 1.4,
                }}>
                  {t.reason}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span className="mono" style={{
                fontSize: 12, color: bandColor, fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}>
                q{t.quality}
              </span>
              <span className="mono" style={{
                fontSize: 10, color: 'var(--stone)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {(t.timeMs/1000).toFixed(1)}s
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function timeHint(s) {
  if (!s || isNaN(s)) return '';
  if (s < 2) return 'barely a breath between';
  if (s < 5) return 'one breath between';
  if (s < 9) return 'considered';
  return 'you took your time';
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
