// Reusable customer feedback widget. Drop it into any container after a guest uses a
// service — online order, reservation, or dine-in receipt — so they can rate it.
//
//   FeedbackWidget.mount(el, { tracking_code | reservation_code | receipt_code | location_id,
//                              prompt, name });
//
// It posts to POST /api/public/feedback (which figures out the location + source from
// whichever reference code is supplied).
(function () {
  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    let rating = 0;
    el.innerHTML = `
      <div style="text-align:center">
        <div style="font-weight:700;margin-bottom:8px">${opts.prompt || 'How was your experience?'}</div>
        <div class="fb-stars" role="radiogroup" aria-label="Star rating" style="font-size:30px;cursor:pointer;letter-spacing:5px;color:var(--gold,#C9A84C);user-select:none">☆☆☆☆☆</div>
        <textarea class="fb-comment" rows="2" placeholder="Tell us more (optional)" style="width:100%;margin-top:10px;padding:9px 12px;border:1.5px solid var(--border,#ddd);border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box"></textarea>
        <div class="fb-alert" style="display:none;margin-top:8px;color:#c0392b;font-size:13px"></div>
        <button class="fb-submit btn btn-primary" style="width:100%;margin-top:8px">Submit feedback</button>
      </div>`;
    const stars = el.querySelector('.fb-stars');
    const alertEl = el.querySelector('.fb-alert');
    const fail = msg => { alertEl.style.display = 'block'; alertEl.textContent = msg; };
    const render = () => { stars.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating); };
    stars.onclick = (e) => {
      const r = stars.getBoundingClientRect();
      rating = Math.max(1, Math.min(5, Math.ceil((e.clientX - r.left) / (r.width / 5))));
      alertEl.style.display = 'none';
      render();
    };
    el.querySelector('.fb-submit').onclick = async () => {
      if (!rating) return fail('Please pick a star rating.');
      const body = { rating, comment: el.querySelector('.fb-comment').value.trim() };
      ['tracking_code', 'reservation_code', 'receipt_code', 'location_id', 'name'].forEach(k => {
        if (opts[k]) body[k] = opts[k];
      });
      const btn = el.querySelector('.fb-submit');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/public/feedback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { btn.disabled = false; btn.textContent = 'Submit feedback'; return fail(d.error || 'Could not submit.'); }
        el.innerHTML = `<div style="color:var(--success,#2e7d32);font-weight:700;padding:10px">✅ ${d.message || 'Thank you for your feedback!'}</div>`;
      } catch {
        btn.disabled = false; btn.textContent = 'Submit feedback';
        fail('Network error. Please try again.');
      }
    };
  }
  window.FeedbackWidget = { mount };
})();
