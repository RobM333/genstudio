import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { BRAND_NAME } from "@/lib/appBrand";

export const metadata: Metadata = { title: `Terms of Use · ${BRAND_NAME}` };

// DRAFT for lawyer review. Placeholders in [brackets] must be filled in before launch.
export default function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These Terms of Use (&quot;Terms&quot;) govern your use of ToastyFly (the &quot;Service&quot;), operated by
        [Company name] (&quot;we&quot;, &quot;us&quot;). By using the Service you agree to these Terms, our{" "}
        <Link href="/acceptable-use">Acceptable Use Policy</Link> and our <Link href="/privacy">Privacy Policy</Link>,
        which are part of these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. Who can use ToastyFly</h2>
      <p>
        You must be at least 18 years old to use the Service. If you use it for a company or other organisation, you
        confirm you are allowed to accept these Terms for it.
      </p>

      <h2>2. What the Service does</h2>
      <p>
        ToastyFly lets you create images, videos and audio (&quot;Outputs&quot;) from prompts, images and other
        material you provide (&quot;Inputs&quot;). It uses AI models run by third-party providers. AI Outputs can be
        wrong, unexpected, or similar to content made for someone else. We do not review Outputs before you receive
        them. We may add, change or remove models and features, and we may set reasonable usage limits to keep the
        Service working for everyone.
      </p>

      <h2>3. Your responsibility for Inputs and Outputs</h2>
      <ul>
        <li>
          You are solely responsible for your Inputs, the Outputs you generate, and how you use, publish or share
          them. You use Outputs at your own risk.
        </li>
        <li>
          Before using an Output, especially in advertising or for commercial purposes, you are responsible for
          checking that it is accurate and lawful and does not infringe anyone&apos;s rights, including copyright,
          trademark, privacy and publicity rights.
        </li>
        <li>
          You confirm you have the rights and permissions needed for your Inputs. If an Input shows or sounds like a
          real person, you confirm you have that person&apos;s permission to use their face, body or voice.
        </li>
        <li>
          Where the law or the platform you post on requires it, you will clearly label Outputs as AI-generated and
          will not remove provenance information or watermarks we or our providers add.
        </li>
        <li>You must follow the <Link href="/acceptable-use">Acceptable Use Policy</Link>.</li>
      </ul>

      <h2>4. Who owns what</h2>
      <ul>
        <li>
          You own your Inputs. As between you and us, you also own your Outputs, to the extent the law allows. You can
          use them commercially, subject to these Terms. We don&apos;t guarantee that Outputs are protected by
          copyright or are unique to you.
        </li>
        <li>
          You give us a limited, non-exclusive licence to store, process, transmit and display your Inputs and Outputs
          only to run, secure and support the Service for you. This licence ends when you delete the content or your
          account, except for copies we must keep by law or that sit in backups for a short time.
        </li>
        <li>
          <strong>We do not use your Inputs or Outputs to train AI models</strong>, and we do not use them in our
          marketing without your permission. Our model providers process your content to create your Outputs under
          their own terms. The <Link href="/privacy">Privacy Policy</Link> explains how.
        </li>
        <li>ToastyFly&apos;s software, design and brand belong to us.</li>
      </ul>

      <h2>5. Safety, moderation and our right to act</h2>
      <p>
        We use automated filters, and our providers use their own safety checks. Some prompts will be refused. We may
        remove or disable Outputs, and suspend or close accounts, if we reasonably believe you broke these Terms or the
        Acceptable Use Policy, or if the law or our providers require it. We report child sexual abuse material and
        other illegal content to the authorities. If we suspend your account, you can ask us to review the decision at
        [contact email].
      </p>

      <h2>6. Reporting content and copyright</h2>
      <ul>
        <li>
          Anyone can report content they believe is illegal, harmful, or uses their likeness without permission by
          writing to [contact email]. We aim to remove non-consensual intimate imagery within 48 hours of a valid report.
        </li>
        <li>
          If you believe content infringes your copyright, send a notice to our designated agent at [DMCA agent name,
          address and email]. Include: your signature, the work you claim is infringed, where the content is, your
          contact details, a statement of good-faith belief, and a statement under penalty of perjury that your notice
          is accurate and that you are the owner or authorised to act for them. Users can send a counter-notice. We
          close the accounts of repeat infringers.
        </li>
      </ul>

      <h2>7. Credits, payments and refunds</h2>
      <p>
        [To be completed when paid plans launch: prices, credits and whether they expire, billing and renewals, taxes,
        cancellation, and refunds. Payments will be handled by our payment processor, and we will not store your card
        details.]
      </p>

      <h2>8. No warranty</h2>
      <p>
        The Service and all Outputs are provided &quot;as is&quot; and &quot;as available&quot;, without warranties of
        any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement. We
        don&apos;t promise the Service will always be available or error-free.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential or
        punitive damages, or for lost profits, revenue, data or goodwill, arising from your use of the Service or any
        Output. Our total liability for any claim is limited to the greater of what you paid us in the 12 months before
        the claim and [US$100]. Some places don&apos;t allow these limits, so they may not all apply to you.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You agree to defend and compensate us for claims, losses and costs (including reasonable legal fees) brought by
        third parties and arising from your Inputs, your Outputs, how you used them, or your breach of these Terms.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms. For important changes, we will give you at least 30 days&apos; notice in the Service
        or by email before they take effect. If you keep using the Service after that, you accept the new Terms. If you
        don&apos;t agree, you can stop using the Service and delete your account.
      </p>

      <h2>12. Ending your use</h2>
      <p>
        You can stop using ToastyFly at any time. We may end or suspend your access as described in section 5. Sections
        that by their nature should continue (such as ownership, liability and indemnity) still apply afterwards.
      </p>

      <h2>13. Disputes and governing law</h2>
      <p>
        These Terms are governed by the laws of [jurisdiction]. [Lawyer to decide: courts of [venue], or individual
        arbitration with an opt-out period and a class-action waiver.]
      </p>

      <h2>14. Contact</h2>
      <p>[Company name], [address], [contact email].</p>
    </LegalPage>
  );
}
