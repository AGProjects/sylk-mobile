// anonymizeEmails — stable email scrubber shared by the support-log share
// flow (LogsModal) and the automatic ANR/crash reporter (appExitReporter).
//
// Replaces every user@domain literal with a random@random substitute. Each
// unique original maps to ONE substitute for the whole export so the text
// still reads coherently — if alice@x.com shows up 30 times, every occurrence
// becomes the same fake address, and two users on the same real domain still
// appear to share a (fake) domain.
//
// Pattern follows the loose RFC 5321 grammar used by chat URIs in Sylk logs:
// local-part chars + '@' + domain with at least one dot. Anchored with \b so
// it doesn't chew through path-like substrings.

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// Friendly placeholder identities — keep it to just `alice` and `bob` so
// scrubbed logs read like the textbook crypto example, not like a guest list.
// Encounter order assigns identities round-robin:
//   1st new email → alice, 2nd → bob, 3rd → alice2, 4th → bob2, ...
// Most chats only have two participants, so the typical scrubbed log is just
// `alice` and `bob` with no numbers — easiest to read.
function _fakeUserFor(idx) {
    // idx is 0-based encounter index across all unique emails.
    const group = Math.floor(idx / 2) + 1;       // 1, 1, 2, 2, 3, 3, ...
    const baseName = idx % 2 === 0 ? 'alice' : 'bob';
    return group === 1 ? baseName : `${baseName}${group}`;
}

export function anonymizeEmails(text) {
    if (!text) return text;
    // Per-export state. Each unique original email gets a stable fake address;
    // each unique original domain gets a stable `exampleN.com` so two users on
    // the same domain still appear to share a domain in the scrubbed text
    // (preserves the readability of the conversation graph).
    const emailMap = new Map();    // "alice@sylk.link" → "alice@example1.com"
    const domainMap = new Map();   // "sylk.link" → "example1.com"
    let userIdx = 0;
    let domainIdx = 0;
    return text.replace(EMAIL_RE, (orig) => {
        if (emailMap.has(orig)) return emailMap.get(orig);
        const fakeUser = _fakeUserFor(userIdx++);
        // Resolve the original domain to its `exampleN.com` substitute,
        // assigning a fresh number the first time we see it.
        const at = orig.indexOf('@');
        const origDomain = orig.slice(at + 1);
        let fakeDomain = domainMap.get(origDomain);
        if (!fakeDomain) {
            domainIdx++;
            fakeDomain = `example${domainIdx}.com`;
            domainMap.set(origDomain, fakeDomain);
        }
        const fake = `${fakeUser}@${fakeDomain}`;
        emailMap.set(orig, fake);
        return fake;
    });
}

export default anonymizeEmails;
