"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_RE } from "@/lib/campaign";
import { money } from "@/lib/money";
import { ITEMS, MAX_POSITIONS, MAX_PRICE_DOLLARS, MIN_PRICE_DOLLARS, SPORTS, SPORT_DEFAULTS } from "@/lib/presets";

/* ============================================================
   THE BUILDER

   Pick items, tick positions, set prices, publish. Validation here is
   for the athlete's benefit; the server runs the same checks again in
   lib/campaign.ts and is the one that counts.
   ============================================================ */

type Row = { id: number; on: boolean; name: string; size: string; price: string };
type Block = { id: number; key: string; name: string; sub: string; custom: boolean; rows: Row[] };

let nextId = 1;
const uid = () => nextId++;

function blockFromPreset(key: string): Block | null {
  const it = ITEMS.find((i) => i.key === key);
  if (!it) return null;
  return {
    id: uid(),
    key,
    name: it.name,
    sub: it.sub,
    custom: false,
    rows: it.positions.map((p) => ({ id: uid(), on: true, name: p.name, size: p.size, price: String(p.price) })),
  };
}

export default function Builder() {
  const router = useRouter();
  const [athlete, setAthlete] = useState("");
  const [sport, setSport] = useState("");
  const [event, setEvent] = useState("");
  const [city, setCity] = useState("");
  const [story, setStory] = useState("");
  const [email, setEmail] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [touched, setTouched] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: string }>({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);

  const say = (text: string, kind = "") => setMsg({ text, kind });

  const onRows = useMemo(() => blocks.flatMap((b) => b.rows.filter((r) => r.on)), [blocks]);
  const total = onRows.reduce((s, r) => s + (parseInt(r.price, 10) > 0 ? parseInt(r.price, 10) : 0), 0);

  function pickSport(value: string) {
    setSport(value);
    if (touched) return;
    const want = SPORT_DEFAULTS[value] ?? [];
    setBlocks(want.map(blockFromPreset).filter((b): b is Block => b !== null));
  }

  function toggleItem(key: string) {
    setTouched(true);
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.key === key);
      if (i >= 0) return bs.filter((_, j) => j !== i);
      const b = blockFromPreset(key);
      return b ? [...bs, b] : bs;
    });
  }

  function addCustom() {
    const name = window.prompt("What is it? (Socks, gloves, backpack, boat...)");
    if (!name || !name.trim()) return;
    setTouched(true);
    setBlocks((bs) => [
      ...bs,
      {
        id: uid(),
        key: `custom-${uid()}`,
        name: name.trim().slice(0, 40),
        sub: "custom",
        custom: true,
        rows: [{ id: uid(), on: true, name: "", size: "", price: "" }],
      },
    ]);
  }

  function patchRow(blockId: number, rowId: number, patch: Partial<Row>) {
    setBlocks((bs) =>
      bs.map((b) => (b.id !== blockId ? b : { ...b, rows: b.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) })),
    );
  }

  function addRow(blockId: number) {
    setBlocks((bs) =>
      bs.map((b) => (b.id !== blockId ? b : { ...b, rows: [...b.rows, { id: uid(), on: true, name: "", size: "", price: "" }] })),
    );
  }

  function removeRow(blockId: number, rowId: number) {
    setBlocks((bs) => bs.map((b) => (b.id !== blockId ? b : { ...b, rows: b.rows.filter((r) => r.id !== rowId) })));
  }

  function removeBlock(blockId: number) {
    setTouched(true);
    setBlocks((bs) => bs.filter((b) => b.id !== blockId));
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!athlete.trim()) return say("Add your name.", "err");
    if (!sport) return say("Pick a sport.", "err");
    if (!EMAIL_RE.test(email.trim())) return say("That email does not look right.", "err");
    if (onRows.length === 0) return say("Turn on an item and tick at least one position.", "err");
    if (onRows.length > MAX_POSITIONS) return say(`${MAX_POSITIONS} positions max across all items.`, "err");
    const bad = onRows.find((r) => {
      const p = parseInt(r.price, 10);
      return !r.name.trim() || !(p >= MIN_PRICE_DOLLARS && p <= MAX_PRICE_DOLLARS);
    });
    if (bad) {
      return say(
        `Every ticked position needs a name and a price between $${MIN_PRICE_DOLLARS} and $${MAX_PRICE_DOLLARS.toLocaleString("en-US")}.`,
        "err",
      );
    }

    setBusy(true);
    say("Publishing...", "note");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          athlete: athlete.trim(),
          sport,
          email: email.trim(),
          event: event.trim(),
          city: city.trim(),
          story: story.trim(),
          positions: blocks.flatMap((b) =>
            b.rows
              .filter((r) => r.on)
              .map((r) => ({ item: b.name, name: r.name.trim(), size: r.size.trim(), priceDollars: parseInt(r.price, 10) })),
          ),
        }),
      });
      const json = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok || !json.slug) throw new Error(json.error || "Something went wrong. Try again.");
      router.push(`/c/${json.slug}?new=1`);
    } catch (err) {
      say((err as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <form className="narrow" onSubmit={publish} noValidate>
      <div className="grid2">
        <div className="f">
          <label htmlFor="athlete">Your name</label>
          <input id="athlete" maxLength={80} placeholder="Sam Rivera" autoComplete="name" value={athlete} onChange={(e) => setAthlete(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="sport">Sport</label>
          <select id="sport" value={sport} onChange={(e) => pickSport(e.target.value)}>
            <option value="">Choose one</option>
            {SPORTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="f">
          <label htmlFor="event">Event or season</label>
          <input id="event" maxLength={120} placeholder="Chicago Marathon 2026" value={event} onChange={(e) => setEvent(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="city">City</label>
          <input id="city" maxLength={80} placeholder="Brooklyn, NY" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
      </div>
      <div className="f">
        <label htmlFor="story">Your story</label>
        <textarea
          id="story"
          maxLength={600}
          placeholder="Who you are, what you are training for, why a brand should want to be on your kit. Two or three sentences is plenty."
          value={story}
          onChange={(e) => setStory(e.target.value)}
        />
        <div className="hint">{story.length}/600</div>
      </div>
      <div className="f">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" maxLength={254} placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="hint">Never shown publicly. You sign in with it later to connect your payouts.</div>
      </div>

      <div className="f" style={{ marginTop: 34 }}>
        <span className="lab">What you race in</span>
        <div className="hint" style={{ margin: "-2px 0 12px" }}>
          Turn on everything a brand could be printed on. Picking a sport suggests a starting set.
        </div>
        <div className="chips">
          {ITEMS.map((it) => (
            <button key={it.key} type="button" className="chip" aria-pressed={blocks.some((b) => b.key === it.key)} onClick={() => toggleItem(it.key)}>
              {it.name}
            </button>
          ))}
          <button type="button" className="chip add" onClick={addCustom}>
            + Something else
          </button>
        </div>
      </div>

      <div className="f">
        <span className="lab">Positions</span>
        <div className="hint" style={{ margin: "-2px 0 0" }}>
          Tick what is for sale on each item. Prices are yours, the defaults are a starting point. Pairs count as one position.
        </div>
        <div className="items">
          {blocks.length === 0 && <div className="nothing">Pick an item above to start.</div>}
          {blocks.map((b) => (
            <div className="item" key={b.id}>
              <div className="item-head">
                <div>
                  <h3 style={{ display: "inline" }}>{b.name}</h3>
                  <span className="sub">{b.sub}</span>
                </div>
                <button type="button" className="rm" onClick={() => removeBlock(b.id)}>
                  Remove
                </button>
              </div>
              <div className="pos-head">
                <span /><span>Position</span><span>Size</span><span>Price</span><span />
              </div>
              <div>
                {b.rows.map((r) => (
                  <div className={`pos-row${r.on ? "" : " off"}`} key={r.id}>
                    <div className="num">
                      <input type="checkbox" aria-label="For sale" checked={r.on} onChange={(e) => patchRow(b.id, r.id, { on: e.target.checked })} />
                    </div>
                    <div className="name">
                      <input maxLength={40} placeholder="Position" value={r.name} onChange={(e) => patchRow(b.id, r.id, { name: e.target.value })} />
                    </div>
                    <div className="size">
                      <input maxLength={40} placeholder="Size" value={r.size} onChange={(e) => patchRow(b.id, r.id, { size: e.target.value })} />
                    </div>
                    <div className="price">
                      <input type="number" min={MIN_PRICE_DOLLARS} max={MAX_PRICE_DOLLARS} step={1} inputMode="numeric" placeholder="0" value={r.price} onChange={(e) => patchRow(b.id, r.id, { price: e.target.value })} />
                    </div>
                    <div className="xw">
                      {(b.custom || b.rows.length > 1) && (
                        <button type="button" className="x" aria-label="Remove" onClick={() => removeRow(b.id, r.id)}>
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="item-foot">
                <button type="button" className="ghost sm" onClick={() => addRow(b.id)}>
                  + Add a position
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="pos-foot">
          <div className="total">
            {onRows.length} positions across {blocks.length} items · fully sold <b>{money(total * 100)}</b>
          </div>
        </div>
      </div>

      <div className="submit">
        <button type="submit" disabled={busy}>
          Publish campaign
        </button>
        <div className={`msg ${msg.kind}`} role="status" aria-live="polite">
          {msg.text}
        </div>
      </div>
    </form>
  );
}
