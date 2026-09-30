import { test } from "node:test";
import assert from "node:assert/strict";
import { toHinglish } from "../lib/devanagari";
import { findAmounts } from "../lib/numbers";
import { mockExtract } from "../lib/extract";

test("Devanagari numbers and money words map to what the normalizer reads", () => {
  assert.equal(toHinglish("अठारह हज़ार लगेगा।"), "atharah hazaar lagega.");
  assert.equal(findAmounts(toHinglish("पाँच हज़ार एडवांस"))[0].value, 5000);
  assert.equal(findAmounts(toHinglish("ढाई हजार"))[0].value, 2500);
  assert.equal(findAmounts(toHinglish("साढ़े तीन हज़ार"))[0].value, 3500);
  assert.equal(findAmounts(toHinglish("१८००० रुपये"))[0].value, 18000);
  assert.equal(toHinglish("Plain Hinglish stays as it is"), "Plain Hinglish stays as it is");
  assert.equal(toHinglish("नमस्ते भाई"), "नमस्ते भाई"); // unknown words are left alone, never guessed
});

test("a Hindi-script conversation still yields price and advance", () => {
  const segs = [
    { speaker: "hirer" as const, text: "दो बेडरूम और हॉल की पुताई, पूरा कितना होगा?", t: 0 },
    { speaker: "worker" as const, text: "अठारह हज़ार लगेगा, पाँच हज़ार एडवांस पहले दे दीजिए।", t: 5 },
  ].map((s) => ({ ...s, text: toHinglish(s.text) }));
  const { terms } = mockExtract(segs, { jobType: "Painting" });
  assert.equal(terms.price, 18000);
  assert.equal(terms.advance, 5000);
});
