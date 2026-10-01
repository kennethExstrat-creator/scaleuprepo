import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Terms of use shown at first sign-in (BRD §11: NDA-aligned terms accepted at first login).
 * PLACEHOLDER wording — to be replaced with the version approved by ScaleUp legal. When the
 * approved text changes materially, bump `platform_settings.terms_version` so every user
 * accepts it again.
 */
export function TermsContent() {
  return (
    <div className="flex flex-col gap-4">
      <Alert className="border-warning/30 bg-warning/5">
        <TriangleAlertIcon className="text-warning" aria-hidden="true" />
        <AlertTitle>Draft - to be confirmed by ScaleUp legal</AlertTitle>
        <AlertDescription>
          This wording is a placeholder for the pilot and will be replaced by the approved terms.
        </AlertDescription>
      </Alert>

      <div
        className="max-h-[50vh] overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5"
        tabIndex={0}
        aria-label="Terms of use"
      >
        <h2>1. About these terms</h2>
        <p>
          The ScaleUp Portfolio Reporting Platform (the &ldquo;Platform&rdquo;) is operated by ScaleUp Malaysia
          (&ldquo;ScaleUp&rdquo;) to collect, review and report information about companies in which funds managed or
          advised by ScaleUp, including ScaleUp Ventures 1 Sdn Bhd and ScaleUp Founders Fund LP, have invested. By
          accepting these terms you agree to them for yourself and, where you use the Platform for a company, on behalf
          of that company.
        </p>

        <h2>2. Confidentiality of investee information</h2>
        <p>
          All information on the Platform &mdash; including financial figures, KPIs, narrative updates, management
          accounts, documents and comments &mdash; is confidential information of the portfolio company concerned and
          of ScaleUp. You must:
        </p>
        <ul>
          <li>use it only for portfolio reporting, monitoring and investor reporting purposes;</li>
          <li>not disclose it to anyone who is not authorised to see it;</li>
          <li>
            not copy, download, export or share it outside the Platform except as your role allows and in line with any
            non-disclosure, shareholders&apos;, investment or fund agreement that applies to you or your organisation;
            and
          </li>
          <li>keep any exported files secure and delete them when they are no longer needed.</li>
        </ul>
        <p>These obligations continue after your access to the Platform ends.</p>

        <h2>3. Your account and acceptable use</h2>
        <ul>
          <li>
            Your account is personal. Do not share your password or authenticator app, and do not let anyone else use
            your account.
          </li>
          <li>
            Sign out on shared devices. For security, the Platform signs you out after 30 minutes of inactivity.
          </li>
          <li>Only submit information that is accurate and complete to the best of your knowledge.</li>
          <li>
            Do not try to access data you are not authorised to see, test or disrupt the Platform&apos;s security,
            upload malicious files, or use automated tools to extract data.
          </li>
          <li>Tell ScaleUp immediately if you suspect your account or any Platform data has been compromised.</li>
        </ul>

        <h2>4. Personal data notice (Personal Data Protection Act 2010)</h2>
        <p>
          ScaleUp processes personal data about you &mdash; such as your name, email address, job title, company role,
          sign-in records and activity on the Platform &mdash; in accordance with the Personal Data Protection Act 2010
          (as amended in 2024). We use it to provide and secure the Platform, verify your identity, communicate with you
          about portfolio reporting, prepare reports for ScaleUp&apos;s funds and investors, and meet legal, regulatory
          and audit obligations.
        </p>
        <p>
          Your personal data may be disclosed to ScaleUp&apos;s fund entities, auditors, professional advisers and
          service providers that host or support the Platform, which may process it in Malaysia or Singapore under
          appropriate safeguards. Providing your personal data is necessary to use the Platform. You may request access
          to or correction of your personal data, or ask questions about how it is handled, by contacting ScaleUp at
          [contact details to be confirmed].
        </p>

        <h2>5. Audit logging and monitoring</h2>
        <p>
          The Platform keeps an audit trail of significant actions, including sign-ins, data entry and edits,
          submissions, approvals, comments, exports, document downloads and changes to users and settings, together
          with who performed them and when. Audit records are kept for seven years and may be reviewed by ScaleUp to
          protect the integrity of portfolio reporting, investigate incidents and support audits.
        </p>

        <h2>6. Changes and ending access</h2>
        <p>
          ScaleUp may update these terms and will ask you to accept material changes before you continue. ScaleUp may
          suspend or end your access at any time, for example when you leave your organisation or a company is no
          longer in the portfolio.
        </p>

        <h2>7. Contact</h2>
        <p>Questions about these terms: [ScaleUp contact to be confirmed].</p>
      </div>
    </div>
  );
}
