# Rental Review — Product Requirements

## Purpose

Allow tenants to review rental property owners, allow users to record interactions with owners, and help users find reviews by clicking locations on a map. Each flat has separate Interactions and Tenant Reviews tabs for these two types of feedback.

## Users

- **Tenant:** Creates an account and submits reviews of rental property owners.
- **User recording an interaction:** Creates an account and adds details of interactions with rental property owners, including interactions before becoming a tenant.
- **Review reader:** Finds and reads owner reviews through the map.
- **Admin:** Reviews review-deletion requests and approves or rejects them.

## Functional requirements

### FR-01: Account creation and mobile OTP sign-in

Users must be able to create an account and sign in using their mobile number and a one-time password (OTP) sent by SMS.

Acceptance criteria:

- A user can register with valid required account information.
- Invalid or duplicate registration information produces a clear error.
- A user can enter a mobile number with its country code and request an OTP by SMS.
- Invalid mobile numbers produce a clear validation error.
- The mobile number must be verified with a valid OTP before registration completes or access to an account is granted.
- A registered user who verifies their mobile number signs in to their existing account; the flow must not create a duplicate account for that number.
- A new user can verify their mobile number and complete any remaining required registration information to create an account.
- Mobile OTP sign-in does not require a password.
- OTPs expire after a configured time and can be used only once; incorrect, expired, or already-used codes produce clear feedback.
- A user can request another OTP after a resend cooldown; a replacement code invalidates the previous code.
- OTP requests and verification attempts are rate-limited, with clear feedback when a limit is reached.
- SMS delivery failures provide clear feedback and a way to retry within the request limits.
- A user must be signed in to submit an owner review.
- A user must be signed in to add an owner interaction.

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
- A user with an inactive account can verify their registered mobile number through the OTP flow and choose to reactivate the account.
- Reactivation restores access to the same account and its existing reviews and interactions without creating a duplicate account.
- Reactivation does not restart or extend the 30-day review editing window.

### FR-04: Tenant reviews of owners

Tenants must be able to submit a rating and written review describing their experience with a rental property owner, and edit their own review for 30 days after its original submission.

Acceptance criteria:

- A signed-in tenant can select or identify the owner being reviewed.
- A tenant can optionally provide proof of tenancy for the flat being reviewed. Omitting proof does not prevent review submission under the current policy.
- The proof-of-tenancy requirement must be configurable, defaulting to optional, so it can be made mandatory in the future without redesigning the review submission flow.
- If the policy is changed to mandatory, new review submissions require proof of tenancy and show a clear validation error when it is missing.
- A review includes a rating and written feedback and is associated with the specific flat and its rental property location.
- Ratings use a five-star scale, from 1 to 5 stars; missing or out-of-range ratings produce a clear validation error.
- Missing required information produces a clear validation error.
- A successfully submitted review is saved and can be retrieved for its associated owner and location.
- Reviews are published immediately after successful submission, without prior admin approval.
- Visitors can read tenant reviews and their ratings without creating an account or signing in.
- The rating is displayed alongside the written feedback wherever the review is shown.
- When an owner has multiple rental properties, each review remains associated with the property it concerns.
- Only the signed-in author with an active account can edit a review's rating and written feedback during the 30-day editing window.
- The editing window starts at the original submission timestamp and closes when 30 days have elapsed. Editing a review does not reset or extend this window.
- A successful edit updates the existing review, and subsequent retrievals show the updated rating and feedback.
- The review interface shows the editing deadline. Once the window closes, editing is unavailable and any edit request is rejected with clear feedback.
- Tenants cannot directly delete submitted reviews, including during the 30-day editing window. The interface offers no direct deletion action, and direct deletion requests from tenants are rejected.
- Authors can request review deletion by an admin through the process in FR-08.

### FR-05: Map-based review search

Users must be able to find tenant reviews and interaction reviews of owners by clicking a rental property location on a map.

Acceptance criteria:

- The application displays a map with selectable markers for rental locations that have tenant reviews, interaction reviews, or both. A location with only interaction reviews must also appear.
- Visitors can browse the map and read its review results without an account.
- Clicking or tapping a marker provides access to the Tenant Reviews and Interactions tabs for the selected flat, displaying the corresponding reviews and identifying the reviewed owner for each review.
- Users can pan and zoom the map to explore other locations.
- If multiple owners have reviews at the same location, users can distinguish their reviews.
- Loading, empty results, and retrieval errors have clear feedback.

### FR-06: Public interaction reviews of owners

Users must be able to post public interaction reviews describing their interactions with a rental property owner, such as a property inquiry, viewing, maintenance request, or deposit discussion. This feature records feedback about an interaction.

Acceptance criteria:

- A signed-in user can select or identify the owner they interacted with.
- An interaction record includes a written description and the date of the interaction.
- Each interaction is associated with the specific flat it concerns.
- A user can add an interaction without first submitting an owner review.
- Multiple interactions can be recorded for the same owner.
- Missing required information produces a clear validation error.
- A successfully posted interaction review is saved and visible to everyone in the relevant flat's Interactions tab, including visitors who are not signed in.
- Interaction reviews are published immediately after successful submission, without prior admin approval.
- Reading interaction reviews does not require an account; posting them requires a signed-in user with an active account.
- Public interaction reviews must not expose the author's private account information, including their mobile number.
- A signed-in author with an active account can add supporting files to their own interaction review when posting it or afterward.
- The author can delete supporting files from their own interaction review. Deleting a file removes its attachment from the review without deleting the interaction review itself.
- Other users cannot add or delete supporting files on another author's interaction review.
- Interaction reviews appear in map results for the associated flat, even when the flat has no tenant reviews.

### FR-07: Separate tabs for the same flat

Each flat's detail page must provide separate **Interactions** and **Tenant Reviews** tabs.

Acceptance criteria:

- Both tabs refer to the same selected flat and identify its owner.
- The Interactions tab lets users record their interactions with the owner about that flat, including interactions before becoming a tenant.
- The Tenant Reviews tab lets tenants submit reviews of their experience with the owner while renting that flat.
- Each tab displays its corresponding records and provides its own submission form. Both interaction reviews and tenant reviews are visible to everyone, including visitors without an account; submission requires sign-in.
- Switching tabs preserves the selected flat; users do not need to select it again.
- Interactions and tenant reviews remain separate record types; submitting one does not require submitting the other.
- Records for different flats remain separate, even when the flats share an owner or building location.

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
- Mobile numbers must be treated as private account information, and OTPs must not appear in application logs or be stored as plain text.
- Proof of tenancy must be kept private and must not be displayed with public reviews.
- Map results must not expose tenants' private account information.
- Account, review, and interaction forms must work on mobile and desktop screens.
- Map markers and review results must be accessible by keyboard, with a text-based way to access the same results.
- The Interactions and Tenant Reviews tabs must be accessible by keyboard and clearly indicate the selected tab.

## Decisions to confirm before implementation

Only unresolved questions are listed below. Once a decision is made, record it in the relevant requirements and remove it from this list.

- **Registration:** Which account fields are required in addition to the verified mobile number?
- **Mobile OTP:** Which SMS provider and countries are supported, and what OTP expiry, resend cooldown, and request and verification limits apply?
- **Interactions:** Can authors edit or delete interaction reviews, or link them to a tenant review?
- **Owner and property records:** How are owners and locations added, identified, and kept free of duplicates?
- **Map clicks:** Is selecting a property marker sufficient, or should clicking any map point also find nearby reviews? If nearby search is needed, what radius applies?
- **Map service:** Which map provider and geographic coverage should be used?
