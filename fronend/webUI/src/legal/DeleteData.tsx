import LegalPage, { Contact } from "./LegalPage";
import { PATHS } from "./site";

/**
 * How to delete data, matching what the app can do today: review deletion is
 * an admin-approved request, deactivation ends
 * sign-in but keeps reviews public, and anything else goes through email.
 */
export default function DeleteData() {
  return (
    <LegalPage title="Delete your data">
      <p>
        You can delete what you posted and your account. Some of it you can do
        yourself in the app; the rest we do for you on request. Sign in first:
        everything below is under <strong>Your account</strong> (the profile
        button at the top right), which opens{" "}
        <strong>Your rental notebook</strong>.
      </p>

      <h2>Delete a tenant review</h2>
      <ol>
        <li>Open Your rental notebook and find the review.</li>
        <li>
          Choose <strong>Request deletion</strong> and give a short reason.
        </li>
        <li>
          We review the request. Once approved, the review disappears from the
          site, stops counting towards the rating, and its tenancy dates are
          freed. You can follow the status in your notebook.
        </li>
      </ol>

      <h2>Delete an interaction</h2>
      <p>
        Interactions can’t be deleted in the app yet. Email <Contact /> from the
        address you sign in with, saying which interaction (building and flat),
        and we will delete it.
      </p>

      <h2>Deactivate or delete your account</h2>
      <ul>
        <li>
          <strong>Deactivate:</strong> in Your rental notebook choose{" "}
          <strong>Deactivate account</strong>, then{" "}
          <strong>Confirm deactivation</strong>. This signs you out everywhere
          and stops sign-in. Your reviews and interactions stay published
          (without your name or email). You can reactivate later by signing in
          with Google again and confirming.
        </li>
        <li>
          <strong>Delete everything:</strong> to erase your account and your
          Google account ID, email and name, and to remove your reviews and
          interactions, email <Contact /> from the address you sign in with,
          with the subject “Delete my data”. Say whether your reviews should be
          removed too. We confirm it’s you, complete the deletion within 30 days
          and email you when it’s done.
        </li>
      </ul>

      <h2>What we may keep</h2>
      <p>
        Short-lived server logs and backups are overwritten on their normal
        schedule, not deleted early. We keep information only where the law
        requires it, for example to deal with a legal claim or a court order.
      </p>

      <h2>If you own a reviewed property</h2>
      <p>
        Reviews don’t name owners. If you own a property and want a review of it
        corrected or removed, email <Contact /> with a link to the review and
        your reason. We aim to respond within 15 days.
      </p>

      <p>
        More about how we handle your data:{" "}
        <a href={PATHS.privacy}>Privacy Policy</a>.
      </p>
    </LegalPage>
  );
}
