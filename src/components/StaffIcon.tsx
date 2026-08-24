import React from "react";

// Generic person silhouette for non-lane roster roles (Coach/Analyst/Manager) - unlike the 5 lane
// positions, these don't have their own distinct in-game icon to borrow, and don't need one: the
// role name is already shown as text right next to this in the roster row, so one shared "staff"
// icon is enough to visually flag "this row isn't a player" at a glance. Plain rounded bust
// (round head + simple rounded shoulders, no collar/tie notch) - a business-suit variant with a
// tie cutout was tried first but read as a muddy blob at this icon's actual small render size.
export const StaffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="12" cy="8" r="4.2" />
    <path d="M4 20.5C4 16.1 7.6 13.5 12 13.5s8 2.6 8 7V21H4v-0.5z" />
  </svg>
);
