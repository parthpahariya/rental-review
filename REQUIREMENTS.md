# Rental Review — Product Requirements

## Purpose

Allow tenants to review their experience of renting a flat, allow users to record interactions about a flat (viewings, enquiries, negotiations), and help users find reviews by clicking locations on a map. Reviews describe the tenancy and the flat; they never name or identify a person. Each flat has separate Interactions and Tenant Reviews tabs for these two types of feedback.

## Users

- **Tenant:** Creates an account and submits reviews of flats they rented.
- **User recording an interaction:** Creates an account and adds details of interactions about a flat, including interactions before becoming a tenant.
- **Review reader:** Finds and reads reviews through the map.
- **Admin:** Reviews review-deletion requests and approves or rejects them.

## Functional requirements

### FR-01: Account creation and Google sign-in

Users must be able to create an account and sign in with their Google account. Google is the only sign-in method; there is no phone, OTP, or password sign-in.

Acceptance criteria:

- A user can sign in with Google in one step; the first sign-in creates the account.
- A returning user signs in to their existing account; the flow must not create a duplicate account for the same Google account, even if its email changes.
- Only Google accounts with a verified email are accepted.
- Failed or cancelled Google sign-in produces clear feedback and can be retried.
- Sign-in attempts are rate-limited, with clear feedback when a limit is reached.
- Accounts created before phone sign-in was removed keep their reviews but can no longer sign in.
- A user must be signed in to submit a tenant review.
- A user must be signed in to add an interaction.

### FR-02: Account deactivation and reactivation

Users must be able to deactivate and later reactivate their own account.

Acceptance criteria:

- A signed-in user can choose to deactivate their account.
- The application explains the effect of deactivation and requests confirmation.
- After confirmation, the account becomes inactive and existing sessions end.
- An inactive account cannot submit or edit reviews, or add interactions.
- Previously visible tenant reviews remain visible while the author's account is inactive, including in the flat's Tenant Reviews tab and map-based review results.
- Recorded interaction reviews remain visible to everyone in the flat's Interactions tab and map-based results while the author's account is inactive.
- The deactivation confirmation explains that existing tenant reviews and interaction reviews will remain visible.
- A user with an inactive account can sign in with the same Google account and choose to reactivate the account.
- Reactivation restores access to the same account and its existing reviews and interactions without creating a duplicate account.
- Reactivation does not restart or extend the 30-day review editing window.

### FR-04: Tenant reviews

Tenants must be able to submit a rating and written review describing their experience of renting a flat, and edit their own review for 30 days after its original submission.

Acceptance criteria:

- Reviews name no person: there is no owner-name field, and the site stores no documents, ID numbers, phone numbers or payment details.
- A review includes a rating, written feedback, and the tenancy period being reviewed, with required start and end dates, and is associated with the specific flat and its rental property location.
- Dates use a start-inclusive, end-exclusive period: the end date must be later than the start date. A tenancy ending on the same date another begins is allowed.
- Two different tenants cannot submit tenant reviews with overlapping tenancy periods for the same flat. A conflict produces a clear validation message and does not publish the new review.
- This restriction applies across different author accounts, not multiple reviews by the same author, and does not apply to interaction reviews or reviews for different flats.
- Conflict checks include existing tenant reviews by inactive authors and reviews with pending or rejected deletion requests. An admin-approved deleted review no longer blocks the period.
- The server must enforce the conflict check atomically so concurrent submissions cannot create overlapping reviews by different tenants.
- Ratings use a five-star scale, from 1 to 5 stars; missing or out-of-range ratings produce a clear validation error.
- Missing required information produces a clear validation error.
- A successfully submitted review is saved and can be retrieved for its flat and location.
- Reviews are published immediately after successful submission, without prior admin approval.
- Visitors can read tenant reviews and their ratings without creating an account or signing in.
- The tenancy period and rating are displayed alongside the written feedback wherever the review is shown.
- Only the signed-in author with an active account can edit a review's rating and written feedback during the 30-day editing window. The tenancy dates remain fixed at submission.
- The editing window starts at the original submission timestamp and closes when 30 days have elapsed. Editing a review does not reset or extend this window.
- A successful edit updates the existing review, and subsequent retrievals show the updated rating and feedback.
- The review interface shows the editing deadline. Once the window closes, editing is unavailable and any edit request is rejected with clear feedback.
- Tenants cannot directly delete submitted reviews, including during the 30-day editing window. The interface offers no direct deletion action, and direct deletion requests from tenants are rejected.
- Authors can request review deletion by an admin through the process in FR-08.

### FR-05: Map-based review search

Users must be able to find tenant reviews and interaction reviews by clicking a rental property location on a map.

Acceptance criteria:

- The application displays a map with selectable markers for rental locations that have tenant reviews, interaction reviews, or both. A location with only interaction reviews must also appear.
- Visitors can browse the map and read its review results without an account.
- Clicking or tapping a marker provides access to the Tenant Reviews and Interactions tabs for the selected flat, displaying the corresponding reviews.
- Users can pan and zoom the map to explore other locations.
- Loading, empty results, and retrieval errors have clear feedback.

### FR-06: Public interaction reviews

Users must be able to post public interaction reviews describing their interactions about a flat, such as a property inquiry, viewing, maintenance request, or deposit discussion. This feature records feedback about an interaction.

Acceptance criteria:

- An interaction record includes a written description and the date of the interaction.
- Each interaction is associated with the specific flat it concerns.
- A user can add an interaction without first submitting a tenant review.
- A user can post at most one interaction review per flat. The same user can review other flats, and different users can each post one interaction review for the same flat.
- A second interaction review by the same user for the same flat is rejected with clear feedback, even if the interaction date differs. Concurrent submissions must not create duplicates.
- Account deactivation/reactivation does not reset this limit.
- Missing required information produces a clear validation error.
- A successfully posted interaction review is saved and visible to everyone in the relevant flat's Interactions tab, including visitors who are not signed in.
- Interaction reviews are published immediately after successful submission, without prior admin approval.
- Reading interaction reviews does not require an account; posting them requires a signed-in user with an active account.
- Public interaction reviews must not expose the author's private account information, including their email.
- Interaction reviews appear in map results for the associated flat, even when the flat has no tenant reviews.

### FR-07: Separate tabs for the same flat

Each flat's detail page must provide separate **Interactions** and **Tenant Reviews** tabs.

Acceptance criteria:

- Both tabs refer to the same selected flat.
- The Interactions tab lets users record their interactions about that flat, including interactions before becoming a tenant.
- The Tenant Reviews tab lets tenants submit reviews of their experience while renting that flat.
- Each tab displays its corresponding records and provides its own submission form. Both interaction reviews and tenant reviews are visible to everyone, including visitors without an account; submission requires sign-in.
- Switching tabs preserves the selected flat; users do not need to select it again.
- Interactions and tenant reviews remain separate record types; submitting one does not require submitting the other.
- Records for different flats remain separate, even when the flats share a building location.

### FR-08: Request review deletion by an admin

Users must be able to request deletion of their own reviews for an admin to consider.

Acceptance criteria:

- A signed-in author with an active account can select their review and submit a deletion request with a reason.
- Deletion requests can be submitted after the 30-day editing window has closed.
- Each request is saved with the review, requesting user, reason, submission timestamp, and status.
- Submitting a request does not delete or hide the review; it remains visible while the request is pending.
- An admin can view pending requests and approve or reject them, recording the decision and its timestamp.
- Only an admin can approve deletion. Approval removes the review and its rating from public views, including the flat's Tenant Reviews tab and map-based review results.
- A rejected request leaves the review and its rating visible.
- The requesting user can view the status of their request: pending, approved, or rejected.

## Supporting requirements

- Existing tenant reviews and their ratings remain visible regardless of whether the author's account is active or inactive. Account status changes must not hide or remove them; an approved admin deletion request under FR-08 can remove them.
- Account deactivation must not hide or remove recorded interaction reviews.
- Account management actions must be restricted to the account holder.
- Credentials and account information must be protected; passwords, if used, must never be stored as plain text.
- Email addresses must be treated as private account information, and Google credentials and session tokens must not appear in application logs or be stored as plain text.
- The site collects no proof of tenancy, documents, ID numbers, phone numbers or names of third parties.
- Map results must not expose tenants' private account information.
- Account, review, and interaction forms must work on mobile and desktop screens.
- Map markers and review results must be accessible by keyboard, with a text-based way to access the same results.
- The Interactions and Tenant Reviews tabs must be accessible by keyboard and clearly indicate the selected tab.

## Decisions to confirm before implementation

Only unresolved questions are listed below. Once a decision is made, record it in the relevant requirements and remove it from this list.

- **Registration:** Which account fields are required in addition to the Google account?
- **Interactions:** Can authors edit or delete interaction reviews, or link them to a tenant review?
- **Property records:** Signed-in users add locations by pinning an empty map point and add flats to existing locations. A new pin is rejected as a duplicate when an existing location with the same building name is within 100 metres, or, for an unnamed pin, when any location is within 30 metres; differently named neighbouring buildings are allowed. A repeated flat label is rejected. Merging or correcting duplicates that slip through (for example, a building pinned twice 40 metres apart) is still undecided.
- **Map clicks (decided):** Selecting a marker opens its flats and reviews. Selecting an empty point drops a draggable pin for adding a new place, and lists existing places within 100 metres so users can review those instead.
- **Map service:** Which map provider and geographic coverage should be used?
