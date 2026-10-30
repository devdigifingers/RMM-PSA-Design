"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitRating } from "../actions";

const CHOICES = [["good", "Good"], ["ok", "OK"], ["bad", "Bad"]];

export function RateForm({ ticketId, signature, initial, preset, comment }) {
  const [state, action, pending] = useActionState(submitRating, { error: "", rating: initial, commented: false });
  const auto = useRef(null);
  const sent = useRef(false);

  // Mail scanners open links without running scripts, so the click only counts once the page runs.
  useEffect(() => {
    if (preset && !sent.current && preset !== initial) {
      sent.current = true;
      auto.current?.requestSubmit();
    }
  }, [preset, initial]);

  const current = state.rating || initial;
  return (
    <>
      <form ref={auto} action={action} hidden>
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="s" value={signature} />
        <input type="hidden" name="rating" value={preset || ""} />
      </form>
      <form action={action} className="rate-choices">
        <input type="hidden" name="ticketId" value={ticketId} />
        <input type="hidden" name="s" value={signature} />
        {CHOICES.map(([key, label]) => (
          <button
            key={key}
            type="submit"
            name="rating"
            value={key}
            className={`rate-choice is-${key}${current === key ? " is-picked" : ""}`}
            aria-pressed={current === key}
            disabled={pending}
          >
            {label}
          </button>
        ))}
      </form>
      {state.error ? <p className="error">{state.error}</p> : null}
      {current ? (
        <>
          <p className="join-org">{state.commented ? "Thanks for the feedback." : `Thanks, we recorded "${CHOICES.find(([key]) => key === current)?.[1]}". You can change it above.`}</p>
          <form action={action} className="stack rate-comment">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="s" value={signature} />
            <input type="hidden" name="rating" value={current} />
            <label>
              Anything you would like to add? (optional)
              <textarea name="comment" rows={3} maxLength={1000} defaultValue={comment} />
            </label>
            <button type="submit" disabled={pending}>Send Feedback</button>
          </form>
        </>
      ) : null}
    </>
  );
}
