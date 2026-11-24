import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";
import { BRAND_NAME } from "@/lib/appBrand";

export const metadata: Metadata = { title: `Privacy Policy · ${BRAND_NAME}` };

// DRAFT for lawyer review. Update when accounts, payments or analytics are added.
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information ToastyFly, operated by [Company name] (&quot;we&quot;), collects, why,
        who we share it with, and the choices you have. In short: we collect only what we need to make your images and
        videos, we don&apos;t sell your data, and we don&apos;t use your content to train AI.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Your content</strong>: the prompts, settings and any images or videos you give us, and the Outputs we
          create for you.
        </li>
        <li>
          <strong>Technical data</strong>: IP address, browser and device type, pages used, and error logs. Our hosting
          provider collects this to deliver and protect the site.
        </li>
        <li>
          <strong>Data stored in your browser</strong>: your gallery and your acceptance of these policies are saved in
          your own browser (local storage), not on our servers. Clearing your browser data removes them.
        </li>
        <li>
          <strong>Founding member sign-ups</strong>: if you claim a founding spot or join the waitlist on our sign-up
          page, we keep your email address, and your first name and what you&apos;d like to make if you give them, with
          the time you signed up. To stop one person filling the list with fake addresses, we also count sign-ups per
          connection per day using a scrambled (hashed) form of your IP address that can&apos;t be read back.
        </li>
        <li>
          <strong>Later, when accounts and payments launch</strong>: your name and email, and billing details handled
          by our payment processor. We will never see or store your full card number.
        </li>
      </ul>
      <p>
        <strong>Your voice and photo, for &quot;You, talking&quot;</strong>: only if you choose to use it, you record about
        a minute of your own voice and add a photo of yourself. The recording is sent to our AI providers (fal.ai and
        the voice services it runs, such as MiniMax and ElevenLabs) to check your spoken consent sentence and to make a
        copy of your voice, which is used only to read the words you type in your own videos. A voice copy is
        biometric information, so we never use it for anything else, never share it with other users and never use
        it to train AI models. The link to your voice copy and your photo are kept in your own browser.
      </p>
      <p>
        Apart from that optional feature, we don&apos;t collect face scans, voiceprints or other biometric
        identifiers, and we ask you not to put sensitive personal information (such as health data or ID numbers) in
        prompts.
      </p>

      <h2>2. How we use it</h2>
      <ul>
        <li>To create your Outputs and run the Service.</li>
        <li>To keep the Service safe: filtering prompts, preventing abuse, and responding to reports.</li>
        <li>To fix problems and understand which features are used, using aggregated data.</li>
        <li>
          To invite founding members and waitlist sign-ups, and email them about their spot and the founding offer. We
          don&apos;t add you to other mailing lists, and every email lets you ask to be removed.
        </li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>
        <strong>We do not use your content to train AI models, we don&apos;t sell your personal information, and we
        don&apos;t use it for targeted advertising.</strong>
      </p>

      <h2>3. Who we share it with</h2>
      <ul>
        <li>
          <strong>AI providers</strong>: your prompts and Inputs are sent to fal.ai and the companies whose models you
          choose (for example Black Forest Labs, Google, Kuaishou, MiniMax and Recraft) only to create your Outputs.
          They process it under their own terms and privacy policies.
        </li>
        <li>
          <strong>Your ElevenLabs account</strong> (optional): if you connect it, your voiceover lines are sent to
          ElevenLabs under your own ElevenLabs terms, and billed to your account there. Your ElevenLabs key is kept in
          your browser. We don&apos;t store it, and when it has to pass through our servers for a request, we don&apos;t
          keep or log it.
        </li>
        <li>
          <strong>Service providers</strong>: hosting (Netlify, which also stores the founding sign-up list), and later our database and payment providers. They act
          on our instructions.
        </li>
        <li>
          <strong>Your browser&apos;s voice typing</strong>: if you tap Speak, your browser turns your voice into text.
          Some browsers (for example Chrome) do this on their maker&apos;s servers. We never receive or keep the
          recording, only the words that appear in the box.
        </li>
        <li><strong>Authorities</strong>, when the law requires it or to protect people from serious harm.</li>
        <li><strong>A buyer or successor</strong>, if our business is sold or merged, under this policy.</li>
      </ul>
      <p>
        Generated files are stored by our AI provider at web addresses that are hard to guess but not password
        protected. Anyone you share a file link with can open it.
      </p>

      <h2>4. How long we keep it</h2>
      <p>
        We keep content only as long as needed to provide the Service. Files stored by our AI provider are kept for
        [retention period per provider]. Server logs are kept for up to [30] days. Founding sign-ups are kept until you
        ask us to remove them, or until you create an account (then your account details take over), and the daily
        sign-up counts are deleted within [30] days. When accounts launch, deleting your
        account deletes your content within [30] days, except where the law requires us to keep it.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Depending on where you live (including under the GDPR in the EU and UK and the CCPA in California), you may have
        the right to access, correct, delete or export your personal information, to object to or limit how we use it,
        and to complain to your data protection authority. We honour Global Privacy Control signals. To use these
        rights, email [privacy email]. We won&apos;t treat you differently for using them.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use only what is needed to run the site, such as browser storage for your gallery and your password sign-in.
        We don&apos;t use advertising cookies. If we add analytics, we will update this policy and ask where required.
      </p>

      <h2>7. Security</h2>
      <p>
        We use encryption in transit (HTTPS), keep API keys on the server only, and limit who can access data. No system
        is perfectly secure, so please don&apos;t put information in prompts that you wouldn&apos;t want stored.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Our providers may process data in the United States and other countries. Where required, we rely on legal
        safeguards such as Standard Contractual Clauses.
      </p>

      <h2>9. Children</h2>
      <p>ToastyFly is for adults 18 and over. We don&apos;t knowingly collect information from children.</p>

      <h2>10. Changes and contact</h2>
      <p>
        We will post updates here and give notice of important changes. Questions: [privacy email], [Company name],
        [address].
      </p>
    </LegalPage>
  );
}
