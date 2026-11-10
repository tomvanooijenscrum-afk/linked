const feedbackForm = document.querySelector("#feedback-form");
const ratingGroup = document.querySelector("#rating-group");
const ratingError = document.querySelector("#rating-error");
const commentField = document.querySelector("#feedback-comment");
const commentCount = document.querySelector("#comment-count");
const submitButton = document.querySelector("#submit-button");
const failureBanner = document.querySelector("#feedback-failure");
const retryButton = document.querySelector("#retry-button");
const confirmation = document.querySelector("#feedback-confirmation");
const confirmationTitle = document.querySelector("#confirmation-title");
const simulateFailure = document.querySelector("#simulate-failure");
const ratingInputs = [...document.querySelectorAll('input[name="rating"]')];
const categoryInputs = [
  ...document.querySelectorAll('input[name="category"]'),
];
const feedbackStore = globalThis.LinkedFeedbackStore;

// "busy" blokkeert dubbele klikken tijdens het verzenden;
// "sent" blokkeert opnieuw verzenden na de bevestiging.
let busy = false;
let sent = false;

function getSelectedRating() {
  const selected = ratingInputs.find((input) => input.checked);
  return selected ? Number(selected.value) : null;
}

function getSelectedCategories() {
  return categoryInputs
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function updateCommentCount() {
  const length = commentField.value.length;
  commentCount.textContent =
    `${length} / ${feedbackStore.maxCommentLength} characters`;
}

function showRatingError(visible) {
  ratingError.hidden = !visible;
  if (visible) {
    ratingGroup.setAttribute("aria-invalid", "true");
  } else {
    ratingGroup.removeAttribute("aria-invalid");
  }
}

function showFailure() {
  failureBanner.hidden = false;
  retryButton.focus();
}

function showConfirmation() {
  // Het formulier verdwijnt, zodat vanaf dit scherm niets nogmaals
  // verzonden kan worden.
  feedbackForm.hidden = true;
  confirmation.hidden = false;
  confirmationTitle.focus();
}

function sendFeedback() {
  if (busy || sent) {
    return Promise.resolve();
  }

  const rating = getSelectedRating();
  if (rating === null) {
    // Invoer blijft staan; alleen de melding verschijnt.
    showRatingError(true);
    ratingInputs[0].focus();
    return Promise.resolve();
  }

  showRatingError(false);
  failureBanner.hidden = true;
  busy = true;
  submitButton.disabled = true;
  submitButton.textContent = "Sending…";

  // Alleen beoordeling, categorieën en opmerking gaan mee.
  const input = {
    rating,
    categories: getSelectedCategories(),
    comment: commentField.value,
  };
  const submission = simulateFailure.checked
    ? Promise.reject(new Error("Simulated failure (demo)."))
    : feedbackStore.submitFeedback(input);

  return submission
    .then(() => {
      sent = true;
      showConfirmation();
    })
    .catch((error) => {
      console.error("Could not send the feedback.", error);
      showFailure();
    })
    .finally(() => {
      busy = false;
      submitButton.disabled = false;
      submitButton.textContent = "Send feedback";
    });
}

feedbackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendFeedback();
});

retryButton.addEventListener("click", () => {
  sendFeedback();
});

for (const input of ratingInputs) {
  input.addEventListener("change", () => {
    showRatingError(false);
  });
}

commentField.addEventListener("input", updateCommentCount);
updateCommentCount();
