import "server-only";
import { applyPlanChanges, foundingStage, listUsers, saveUser } from "./store";
import { foundingReminderEmail, sendEmail } from "./mail";

// Once a day (netlify/functions/founding-daily.mts) and from the owner's page:
// moves anyone whose free month has ended to the Free plan, and sends the
// founding price message to members whose month ends in the next few days.
// Each person gets the message once per free month. Nothing is ever charged.

export type ReminderRun = { checked: number; sent: string[]; failed: string[]; movedToFree: number };

export async function runFoundingReminders(origin: string, now = Date.now()): Promise<ReminderRun> {
  const out: ReminderRun = { checked: 0, sent: [], failed: [], movedToFree: 0 };
  for (const before of await listUsers()) {
    out.checked++;
    const u = await applyPlanChanges(before, now).catch(() => before);
    if (before.plan !== "free" && u.plan === "free") out.movedToFree++;
    const stage = foundingStage(u, now);
    if (stage?.stage !== "ending-soon" || u.reminderSent === stage.endsOn) continue;
    const mail = foundingReminderEmail({ name: u.name, endsOn: stage.endsOn, link: `${origin}/account` });
    const sent = await sendEmail(u.email, mail.subject, mail.text, mail.html);
    if (sent.ok) {
      await saveUser(u.id, (x) => ({ ...x, reminderSent: stage.endsOn }));
      out.sent.push(u.email);
    } else out.failed.push(u.email);
  }
  return out;
}
