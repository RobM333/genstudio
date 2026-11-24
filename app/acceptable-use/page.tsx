import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Acceptable Use Policy · GenStudio" };

// DRAFT for lawyer review.
export default function AcceptableUse() {
  return (
    <LegalPage title="Acceptable Use Policy">
      <p>
        This policy explains what you may not create or do with GenStudio. It is part of our Terms of Use. We may
        block prompts, remove Outputs and suspend or close accounts that break it, and we report illegal content where
        the law requires.
      </p>

      <h2>Never allowed</h2>
      <ul>
        <li>
          <strong>Anything sexual involving minors</strong>, or anyone who appears to be a minor. This is illegal and is
          reported to the authorities.
        </li>
        <li>
          <strong>Sexual or nude content of real, identifiable people</strong>, including celebrities and public
          figures, whether or not they are named.
        </li>
        <li>
          <strong>Deceptive content about real people</strong>: fake images, videos or voices of a real person that
          could be taken as real, such as fake endorsements, fake news, or impersonation, without their permission.
        </li>
        <li>
          <strong>Intimate images without consent</strong>, including &quot;undressing&quot; or sexualising a photo of
          someone.
        </li>
        <li>
          <strong>Copying a real person&apos;s face, body or voice without their permission</strong>, including voice
          clones. &quot;You, talking&quot; is for your own voice and your own face only: never record or upload someone
          else, a public figure, or a child.
        </li>
        <li>Harassment, bullying, threats, or content that promotes hatred or violence against people or groups.</li>
        <li>Content that promotes self-harm, terrorism, or serious violence.</li>
        <li>Instructions or imagery meant to help commit crimes, fraud, scams or phishing.</li>
      </ul>

      <h2>Respect other people&apos;s rights</h2>
      <ul>
        <li>
          Don&apos;t use other companies&apos; logos, trademarks or brand look in a way that suggests they made or
          endorse your content.
        </li>
        <li>Don&apos;t try to copy specific copyrighted characters, artworks or footage you don&apos;t have rights to.</li>
        <li>Don&apos;t upload or use other people&apos;s private information or photos without permission.</li>
      </ul>

      <h2>Reporting and enforcement</h2>
      <ul>
        <li>Report content that breaks this policy to [contact email]. Reports about minors are handled first.</li>
        <li>
          Depending on how serious it is, we may refuse the prompt, remove content, suspend or close the account, and
          report to the authorities. You can ask us to review a suspension.
        </li>
      </ul>

      <h2>Advertising and disclosure</h2>
      <ul>
        <li>Follow advertising laws and platform rules. Don&apos;t make false claims about products.</li>
        <li>Label AI-generated content where the law or the platform you post on requires it.</li>
      </ul>

      <h2>Using the Service fairly</h2>
      <ul>
        <li>Don&apos;t try to get around our safety filters, limits or security.</li>
        <li>Don&apos;t scrape the Service or use it to build or train a competing AI model.</li>
        <li>Don&apos;t share your access with others or resell the Service without our written permission.</li>
      </ul>
    </LegalPage>
  );
}
