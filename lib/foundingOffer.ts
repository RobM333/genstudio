// The founding offer's words, shared by the Founding page, the account page and
// the emails. Prices here are only ever estimates: the exact founding price is
// confirmed before anyone pays, and nothing here charges anyone.

import { foundingPriceText, OFFER, REFERRAL } from "./founding";
import { PLANS, whatCreditsMake } from "./pricing";

export const PLAN_PRICE = (id: string) => PLANS.find((p) => p.id === id)!.monthly;

export const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "roughly 120 pictures, or about 12 to 14 short videos, or a mix of both" for the free month's credits. */
export const FREE_MONTH_MAKES = whatCreditsMake(OFFER.freeCredits).text;

/** "about $13 a month for Creator instead of $19". */
export function foundingPriceShort(id: "creator" | "pro"): string {
  const name = id === "creator" ? "Creator" : "Pro";
  return `${foundingPriceText(PLAN_PRICE(id))} a month for ${name} instead of $${PLAN_PRICE(id)}`;
}

export const SHARE_LINE = `For each friend who joins with your link, you both get ${REFERRAL.bonus} bonus credits, for up to ${REFERRAL.maxFriends} friends.`;

/** The words of the founding price message, shared by the email and the account page. */
export function foundingPriceLines(endsOn: string, ended = false): string[] {
  if (ended)
    return [
      `Your free Founding month of ${OFFER.freePlan} ended on ${longDay(endsOn)}, so your account is on the ${OFFER.afterPlan} plan now (${OFFER.afterCredits} credits a month). Everything you made is still saved.`,
      `Your founding price is still yours if you'd like to come back to a paid plan: ${foundingPriceShort("creator")}, or ${foundingPriceShort("pro")}. These are estimates, and we'll confirm the exact price before you pay anything.`,
    ];
  return [
    `Your free Founding month of ${OFFER.freePlan} ends on ${longDay(endsOn)}.`,
    `If you'd like to keep going, you keep a founding price for as long as you stay, planned at ${OFFER.foundingDiscount} off: ${foundingPriceShort("creator")}, or ${foundingPriceShort("pro")}. These are estimates. We'll confirm the exact price before you pay anything.`,
    `We don't have your card, so nothing is charged by itself. If you do nothing, your account moves to the ${OFFER.afterPlan} plan (${OFFER.afterCredits} credits a month) and everything you've made stays saved.`,
  ];
}
