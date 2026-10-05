# Rental Review — Product Requirements

## Purpose

Allow tenants to review rental property owners and help users find those reviews by clicking locations on a map.

## Users

- **Tenant:** Creates an account and submits reviews of rental property owners.
- **Review reader:** Finds and reads owner reviews through the map.

## Functional requirements

### FR-01: Account creation

Users must be able to create an account and sign in to it.

Acceptance criteria:

- A user can register with valid required account information.
- Invalid or duplicate registration information produces a clear error.
- A registered user can sign in and access their account.
- A user must be signed in to submit an owner review.

### FR-02: Account deactivation

Users must be able to deactivate their own account. Deactivation is distinct from permanent deletion.

Acceptance criteria:

- A signed-in user can choose to deactivate their account.
- The application explains the effect of deactivation and requests confirmation.
- After confirmation, the account becomes inactive and existing sessions end.
- An inactive account cannot submit reviews.

### FR-03: Account deletion

Users must be able to request permanent deletion of their own account.

Acceptance criteria:

- A signed-in user can choose to delete their account.
- The application explains the effect of deletion and requests confirmation.
- Once deletion is complete, existing sessions end and the deleted account can no longer be used to sign in.
- Account data and previously submitted reviews are handled according to the deletion policy agreed before implementation.

### FR-04: Tenant reviews of owners

Tenants must be able to submit reviews describing their experience with a rental property owner.

Acceptance criteria:

- A signed-in tenant can select or identify the owner being reviewed.
- A review includes written feedback and is associated with the relevant rental property location.
- Missing required information produces a clear validation error.
- A successfully submitted review is saved and can be retrieved for its associated owner and location.
- When an owner has multiple rental properties, each review remains associated with the property it concerns.

### FR-05: Map-based review search

Users must be able to find owner reviews by clicking a rental property location on a map.

Acceptance criteria:

- The application displays a map with selectable markers for rental locations that have reviews.
- Clicking or tapping a marker displays the reviews associated with that location and identifies the reviewed owner for each review.
- Users can pan and zoom the map to explore other locations.
- If multiple owners have reviews at the same location, users can distinguish their reviews.
- Loading, empty results, and retrieval errors have clear feedback.

## Supporting requirements

- Account management actions must be restricted to the account holder.
- Credentials and account information must be protected; passwords, if used, must never be stored as plain text.
- Map results must not expose tenants' private account information.
- Account and review forms must work on mobile and desktop screens.
- Map markers and review results must be accessible by keyboard, with a text-based way to access the same results.

## Decisions to confirm before implementation

- **Registration:** Which account fields and sign-in method are required?
- **Deactivation:** Can users reactivate their accounts, and do their reviews remain visible while inactive?
- **Deletion:** Are existing reviews deleted or retained anonymously, and when is deletion completed?
- **Reviews:** Is a rating required alongside written feedback? Can tenants edit or delete reviews?
- **Tenant eligibility:** Is proof of tenancy required before submitting a review?
- **Owner and property records:** How are owners and locations added, identified, and kept free of duplicates?
- **Review visibility:** Can visitors read reviews without an account? Are reviews published immediately or reviewed first?
- **Map clicks:** Is selecting a property marker sufficient, or should clicking any map point also find nearby reviews? If nearby search is needed, what radius applies?
- **Map service:** Which map provider and geographic coverage should be used?
