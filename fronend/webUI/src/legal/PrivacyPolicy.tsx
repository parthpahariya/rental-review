import LegalPage, { Contact, Operator } from "./LegalPage";
import { PATHS, SITE } from "./site";

/**
 * Describes what the app actually collects and does. Keep it in step with the
 * code: python/backend/app/models.py (what is stored), API_CONTRACTS.md (what
 * is public) and src/maps (which map provider sees what).
 */
export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {SITE.name} ({SITE.url}) lets tenants share experiences of rented homes.
        This policy explains what personal data we collect, why, who can see it,
        and the choices you have. It is run by <Operator />, who is responsible
        for your data. Contact: <Contact />.
      </p>

      <h2>What we collect</h2>
      <h3>When you sign in with Google</h3>
      <ul>
        <li>
          Your Google account ID, email address and the name on your Google
          account. We never see your Google password.
        </li>
        <li>
          A display name, if you choose your own. It is private: only you see
          it, and it never appears with your reviews.
        </li>
      </ul>
      <h3>What you post</h3>
      <ul>
        <li>
          <strong>Tenant reviews:</strong> rating, written feedback, and tenancy
          start and end dates.
        </li>
        <li>
          <strong>Interactions:</strong> a description and the date.
        </li>
        <li>
          <strong>Places you add:</strong> building name, address, flat label
          and the map position you pin.
        </li>
        <li>
          <strong>Deletion requests:</strong> the reason you give when asking to
          delete a review.
        </li>
      </ul>
      <p>
        We don’t ask for the names of owners or anyone else, and we don’t accept
        documents, ID numbers, phone numbers or payments.
      </p>
      <h3>Collected automatically</h3>
      <ul>
        <li>
          <strong>Sign-in sessions:</strong> stored only as a scrambled (hashed)
          token, valid for 7 days or until you sign out.
        </li>
        <li>
          <strong>Abuse protection:</strong> sign-in attempts are counted per
          network address to stop misuse. We store only a scrambled form of the
          address, and the count resets every hour.
        </li>
        <li>
          <strong>Server logs:</strong> the page or action requested, the result
          and the time. Our web server may also log your IP address and browser
          type. Logs are rotated and kept only for a short time.
        </li>
        <li>
          <strong>Your browser:</strong> your sign-in is kept in session storage
          (cleared when you close the tab), and whether you hid the results list
          is kept in local storage. We use no advertising or analytics cookies.
        </li>
      </ul>

      <h2>What is public</h2>
      <p>
        Reviews and interactions are published for everyone to read, with the
        building, address, flat, rating, dates and text. They are{" "}
        <strong>not</strong> shown with your name, email or account. Your email,
        deletion requests and account details are never public. Please write
        only about your own experience, stick to facts, and don’t name people or
        include anyone’s phone number, email or other private details.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To let you sign in and manage your reviews.</li>
        <li>To publish reviews and show places on the map.</li>
        <li>
          To keep reviews trustworthy: one interaction per person per flat and
          no overlapping tenancies.
        </li>
        <li>To prevent abuse, keep the service secure and fix problems.</li>
        <li>To respond to your requests and to legal obligations.</li>
      </ul>
      <p>
        We use your data with your consent, given when you sign in and post, and
        as the law allows. You can withdraw consent at any time (see{" "}
        <a href={PATHS.deleteData}>Delete your data</a>). We do not sell your
        data or use it for advertising.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Google</strong>, to sign you in (Google’s own privacy policy
          applies to your Google account).
        </li>
        <li>
          <strong>Our map provider</strong> (Ola Maps, or OpenStreetMap with the
          Photon search service): your browser loads the map from them and sends
          them the text you type in the search box and the area you view. They
          also see your IP address. We send them no account information.
        </li>
        <li>
          <strong>Hosting:</strong> our servers and database run on Google
          Cloud.
        </li>
        <li>
          <strong>Authorities</strong>, when Indian law or a court requires it.
        </li>
      </ul>

      <h2>Property owners</h2>
      <p>
        Reviews describe a tenancy in a building and flat; they do not name the
        owner. If you own a property and believe a review of it is inaccurate,
        unlawful or identifies a person, contact <Contact /> with a link to the
        review. We will review it and respond as described below.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account data, for as long as your account exists.</li>
        <li>
          Reviews and interactions stay published until they are deleted,
          including after you deactivate your account, unless you ask us to
          remove them.
        </li>
        <li>
          Sessions expire after 7 days; abuse counters reset every hour; server
          logs are rotated.
        </li>
        <li>
          We keep what the law requires us to keep, for as long as it requires.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under India’s Digital Personal Data Protection Act, 2023 you can ask us:
        for a summary of your personal data and how we use it; to correct or
        update it; to erase it; and to nominate someone to act for you. You can
        also withdraw consent. Contact <Contact />. If you are not satisfied
        with our response, you can complain to the Data Protection Board of
        India.
      </p>
      <p>
        How to delete your reviews or account is explained on{" "}
        <a href={PATHS.deleteData}>Delete your data</a>.
      </p>

      <h2>Grievances</h2>
      <p>
        Send complaints about content or about your data to <Contact />. We
        acknowledge complaints within 24 hours and aim to resolve them within 15
        days.
      </p>

      <h2>Security</h2>
      <p>
        Data travels over HTTPS. Sessions are stored as scrambled tokens, and
        access to the database is restricted. No system is perfectly secure; if
        a breach affects your data, we will notify you and the authorities as
        the law requires.
      </p>

      <h2>Children</h2>
      <p>{SITE.name} is for adults. Do not use it if you are under 18.</p>

      <h2>Changes</h2>
      <p>
        We will update this page when our practices change and change the date
        at the top. For significant changes we will tell signed-in users.
      </p>
    </LegalPage>
  );
}
