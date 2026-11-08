(() => {
  const form = document.querySelector('#review-form');
  if (!form) return;
  const list = document.querySelector('#reviews-list');
  const status = document.querySelector('#review-status');
  const dataStatus = document.querySelector('#reviews-data-status');
  const stars = [...form.querySelectorAll('.star-picker input')];
  const starLabels = [...form.querySelectorAll('.star-picker label')];
  const selectedLabel = document.querySelector('#selected-rating');
  const starNames = ['', '1 star', '2 stars', '3 stars', '4 stars', '5 stars'];
  const safeText = (element, value) => { element.textContent = value; };

  const setPickedRating = () => {
    const value = Number(form.querySelector('input[name="rating"]:checked')?.value || 0);
    starLabels.forEach((label, index) => label.classList.toggle('is-lit', index < value));
    safeText(selectedLabel, value ? starNames[value] : 'Select a rating');
  };
  stars.forEach(radio => radio.addEventListener('change', setPickedRating));
  setPickedRating();

  function renderReviews(payload) {
    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    const average = Number(payload.averageRating || 0);
    const count = Number(payload.approvedCount || 0);
    safeText(document.querySelector('#average-rating'), average.toFixed(1));
    safeText(document.querySelector('#review-count'), `${count} approved ${count === 1 ? 'review' : 'reviews'}`);
    const summaryStars = document.querySelector('#summary-stars');
    summaryStars.textContent = count ? '★'.repeat(Math.round(average)) + '☆'.repeat(5 - Math.round(average)) : '☆☆☆☆☆';
    summaryStars.setAttribute('aria-label', count ? `${average.toFixed(1)} out of 5 from ${count} approved reviews` : 'No approved ratings yet');
    list.replaceChildren();
    if (!reviews.length) {
      const empty = document.createElement('div');
      empty.className = 'reviews-state';
      empty.textContent = 'No approved reviews yet. Be the first to share your experience.';
      list.append(empty);
      safeText(dataStatus, 'Only approved customer reviews are displayed here.');
      return;
    }
    for (const review of reviews) {
      const card = document.createElement('article');
      card.className = 'review-card';
      const top = document.createElement('div');
      top.className = 'review-card-top';
      const rating = document.createElement('span');
      rating.className = 'review-stars';
      rating.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
      rating.setAttribute('aria-label', `${review.rating} out of 5 stars`);
      const date = document.createElement('time');
      date.dateTime = review.createdAt;
      date.textContent = new Date(review.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      top.append(rating, date);
      const quote = document.createElement('p');
      quote.className = 'review-quote';
      quote.textContent = review.review;
      const author = document.createElement('div');
      author.className = 'review-author';
      const name = document.createElement('strong');
      name.textContent = review.name;
      author.append(name);
      if (review.business) {
        const business = document.createElement('span');
        business.textContent = review.business;
        author.append(business);
      }
      card.append(top, quote, author);
      list.append(card);
    }
    safeText(dataStatus, 'Showing the newest approved customer reviews first.');
  }

  async function loadReviews() {
    try {
      const response = await fetch('/api/reviews', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Review service unavailable.');
      renderReviews(payload);
    } catch {
      list.replaceChildren();
      const unavailable = document.createElement('div');
      unavailable.className = 'reviews-state reviews-unavailable';
      unavailable.textContent = 'Approved reviews cannot load until the review database is connected.';
      list.append(unavailable);
      safeText(dataStatus, 'No review data is being presented. Configure the D1 database and Pages Function to load real approved reviews.');
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    safeText(status, 'Sending your review for moderation…');
    const fields = Object.fromEntries(new FormData(form).entries());
    delete fields.website;
    fields.rating = Number(fields.rating);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...fields, website: form.elements.website.value })
      });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error(`Review service returned an invalid response (HTTP ${response.status}). Your review was not saved.`); }
      if (!response.ok) throw new Error(payload.error || 'Your review could not be saved.');
      safeText(status, payload.message || 'Your review was saved and is awaiting approval.');
      form.reset();
      setPickedRating();
      await loadReviews();
    } catch (error) {
      safeText(status, error instanceof TypeError
        ? 'Not saved. The review service is not connected or could not be reached. Please try again after it is configured.'
        : error.message);
    } finally { button.disabled = false; }
  });

  loadReviews();
})();
