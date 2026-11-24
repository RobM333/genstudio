import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";
import { BRAND_NAME } from "@/lib/appBrand";

export const metadata: Metadata = { title: `Privacy Policy · ${BRAND_NAME}` };

// DRAFT for lawyer review. Accounts are covered; update when payments or analytics are added.
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
          <strong>Your account</strong>: your email address, your first name if you gave it, your plan, your credit
          balance and a history of what your credits were used for, and when you signed up and last signed in. To sign
          you in we email you a one-time code. We keep only a scrambled (hashed) copy of it, for 10 minutes or until
          it is used, and we put a sign-in cookie in your browser.
        </li>
        <li>
          <strong>Your saved work</strong>: when you are signed in, your gallery (the list of your results, with their
          prompts, settings and file links), your Brand kit, your reference pictures, your saved ideas, your chats
          with the studio assistant and your &quot;You, talking&quot; setup are saved with your account, so they follow
          you to any device. A copy is also kept in your browser (local storage) while you use the studio, and it is
          removed from that browser when you sign out.
        </li>
        <li>
          <strong>Founding member sign-ups</strong>: if you claim a founding spot or join the waitlist on our sign-up
          page, we keep your email address, and your first name and what you&apos;d like to make if you give them, with
          the time you signed up. To stop one person filling the list with fake addresses, we also count sign-ups per
          connection per day using a scrambled (hashed) form of your IP address that can&apos;t be read back.
        </li>
        <li>
          <strong>Later, when payments launch</strong>: billing details handled by our payment processor. We will
          never see or store your full card number.
        </li>
      </ul>
      <p>
        <strong>Your voice and photo, for &quot;You, talking&quot;</strong>: only if you choose to use it, you record about
        a minute of your own voice and add a photo of yourself. The recording is sent to our AI providers (fal.ai and
        the voice services it runs, such as MiniMax and ElevenLabs) to check your spoken consent sentence and to make a
        copy of your voice, which is used only to read the words you type in your own videos. A voice copy is
        biometric information, so we never use it for anything else, never share it with other users and never use
        it to train AI models. The link to your voice copy and your photo are kept with your account (and in your
        browser), and your voice copy can only be used by your own account. You can delete your voice copy at any time
        on your account page or in &quot;You, talking&quot;. After that it can never be used through ToastyFly again.
        [Lawyer to confirm: how long the voice service keeps the copy it holds, and how we ask it to delete it.]
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
        <li>To improve results for everyone, using your feedback (see below).</li>
        <li>
          To invite founding members and waitlist sign-ups, and email them about their spot and the founding offer. We
          don&apos;t add you to other mailing lists, and every email lets you ask to be removed.
        </li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>
        <strong>Learning from feedback</strong>: when you fix, remake, check or rate a result, we note what kind of
        problem it was (for example &quot;words on screen misspelled&quot;), whether it was a picture or a video, and
        which model made it. When the same kind of problem keeps coming up for many different people, we update the
        general instructions our prompt helper follows, so it happens less for everyone. To count different people
        without knowing who they are, your browser sends a random number that we scramble. We don&apos;t keep your
        name, email, pictures, faces or voice for this. If what you typed doesn&apos;t match a known problem, we keep a
        short copy with contact details and links removed for up to 30 days so we can read it; the rest of these
        notes are deleted after about four months. Your own words, pictures and results are never shown to other users
        or added to their prompts, and this is not used to train AI models.
      </p>
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
          your browser and, when you are signed in, saved encrypted with your account so it works on your other
          devices. Disconnecting it in your Brand kit removes it. When it has to pass through our servers for a
          request, we don&apos;t log it.
        </li>
        <li>
          <strong>Service providers</strong>: hosting and storage (Netlify, which stores your account, your saved work
          and the founding sign-up list), email (Resend, which sends sign-in codes and invites), and later our payment
          provider. They act on our instructions.
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
        sign-up counts are deleted within [30] days. You can delete your account at any time on your account page.
        That deletes your account details, credit history, saved work, voice copy link and ElevenLabs connection
        straight away (backups at our hosting provider may take up to [30] days to clear), except where the law
        requires us to keep something. Pictures and videos already made stay at our AI provider&apos;s file storage
        for its retention period; email us to ask for them to be removed sooner.
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
        We use only what is needed to run the site: a sign-in cookie that keeps you signed in for up to 30 days, and
        browser storage for your studio work while you use it.
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
