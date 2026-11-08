(() => {
  const form = document.querySelector('#admin-login');
  const list = document.querySelector('#admin-list');
  const status = document.querySelector('#admin-status');
  const logout = document.querySelector('#admin-logout');
  let token = '';
  const setStatus = text => { status.textContent = text; };

  async function loadPending() {
    setStatus('Loading pending reviews…');
    try {
      const response = await fetch('/api/admin/reviews', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load pending reviews.');
      list.replaceChildren();
      logout.hidden = false;
      if (!data.reviews.length) {
        setStatus('There are no pending reviews.');
        return;
      }
      setStatus(`${data.reviews.length} pending ${data.reviews.length === 1 ? 'review' : 'reviews'}.`);
      for (const review of data.reviews) {
        const card = document.createElement('article');
        card.className = 'admin-review-card';
        const heading = document.createElement('div');
        heading.className = 'admin-review-meta';
        const person = document.createElement('strong');
        person.textContent = review.name;
        const business = document.createElement('span');
        business.textContent = review.business || 'No business name';
        const score = document.createElement('span');
        score.className = 'review-stars';
        score.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        score.setAttribute('aria-label', `${review.rating} out of 5 stars`);
        const date = document.createElement('time');
        date.dateTime = new Date(Number(review.created_at) * 1000).toISOString();
        date.textContent = new Date(Number(review.created_at) * 1000).toLocaleString();
        heading.append(person, business, score, date);
        const text = document.createElement('p');
        text.textContent = review.review;
        const actions = document.createElement('div');
        actions.className = 'admin-review-actions';
        for (const [action, label] of [['approved', 'Approve and publish'], ['rejected', 'Reject']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = action === 'approved' ? 'button' : 'admin-reject';
          button.textContent = label;
          button.addEventListener('click', () => moderate(review.id, action, card));
          actions.append(button);
        }
        card.append(heading, text, actions);
        list.append(card);
      }
    } catch (error) {
      list.replaceChildren();
      if (error.message.includes('authorization')) {
        token = '';
        logout.hidden = true;
      }
      setStatus(error.message);
    }
  }

  async function moderate(id, decision, card) {
    setStatus('Saving moderation decision…');
    try {
      const response = await fetch('/api/admin/reviews', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, status: decision })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the moderation decision.');
      card.remove();
      setStatus(data.message);
      if (!list.children.length) setStatus('There are no pending reviews.');
    } catch (error) { setStatus(error.message); }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    token = new FormData(form).get('token').trim();
    if (token) loadPending();
  });
  logout.addEventListener('click', () => {
    token = '';
    form.reset();
    list.replaceChildren();
    logout.hidden = true;
    setStatus('Admin token cleared from this page.');
  });
})();
