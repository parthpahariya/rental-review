import re
from datetime import date
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


def calendar_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Use a calendar date in YYYY-MM-DD format")
    return value


CalendarDate = Annotated[date, BeforeValidator(calendar_date)]

Nonblank = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=10000)
]
Rating = Annotated[int, Field(strict=True, ge=1, le=5)]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GoogleBody(Body):
    # The ID token (JWT) Google Identity Services hands the browser.
    credential: Annotated[str, Field(min_length=20, max_length=4096)]
    reactivate: bool = False


class ConfirmationBody(Body):
    confirm: Literal[True]


class ReviewBody(Body):
    tenancy_start_date: CalendarDate
    tenancy_end_date: CalendarDate
    rating: Rating
    feedback: Nonblank

    @model_validator(mode="after")
    def validate_period(self):
        if self.tenancy_end_date <= self.tenancy_start_date:
            raise ValueError("Tenancy end must be later than tenancy start")
        return self


class EditBody(Body):
    rating: Rating | None = None
    feedback: Nonblank | None = None

    @model_validator(mode="after")
    def not_empty(self):
        if not self.model_fields_set or any(
            getattr(self, k) is None for k in self.model_fields_set
        ):
            raise ValueError("Provide rating or feedback; null is not accepted")
        return self


class InteractionBody(Body):
    description: Nonblank
    interaction_date: CalendarDate


class DeletionBody(Body):
    reason: Nonblank


class DecisionBody(Body):
    decision: Literal["approved", "rejected"]
    decision_note: Nonblank | None = None


ShortText = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)
]
FlatLabel = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)
]


class FlatBody(Body):
    label: FlatLabel


class LocationEditBody(Body):
    """Partial edit of a place; send only the fields that change."""

    address: Annotated[
        str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=500)
    ] | None = None
    building_name: ShortText | None = None
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)] | None = None
    longitude: (
        Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)] | None
    ) = None

    @model_validator(mode="after")
    def complete(self):
        sent = self.model_fields_set
        if not sent:
            raise ValueError("Provide at least one field to change")
        if ("latitude" in sent) != ("longitude" in sent):
            raise ValueError("Move the pin with both latitude and longitude")
        for key in sent - {"building_name"}:
            if getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class LocationBody(Body):
    address: Annotated[
        str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=500)
    ]
    building_name: ShortText | None = None
    latitude: Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
    longitude: Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
    flat_label: FlatLabel


class ProfileBody(Body):
    # A name of your choice, or null to go back to your Google account's name.
    name: ShortText | None
