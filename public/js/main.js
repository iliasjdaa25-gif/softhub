// ============ STATE ============
let currentPage = 1;
let currentSearch = '';
let searchTimeout = null;

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  loadPrograms();
  setupSearch();
});

// ============ SEARCH ============
function setupSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = input.value.trim();
      currentPage = 1;
      loadPrograms();
    }, 300);
  });
}

// ============ LOAD PROGRAMS ============
async function loadPrograms() {
  const grid = document.getElementById('programsGrid');
  const loading = document.getElementById('loading');
  const empty = document.getElementById('emptyState');
  const resultCount = document.getElementById('resultCount');

  if (!grid) return;

  grid.innerHTML = '';
  loading.style.display = 'block';
  empty.style.display = 'none';

  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 12,
      search: currentSearch,
    });

    const res = await fetch('/api/programs?' + params);
    const data = await res.json();

    loading.style.display = 'none';

    // Update stats
    const totalCount = document.getElementById('totalCount');
    if (totalCount) totalCount.textContent = data.total;
    if (resultCount) resultCount.textContent = `${data.total} program${data.total !== 1 ? 's' : ''}`;

    if (data.programs.length === 0) {
      empty.style.display = 'block';
      return;
    }

    grid.innerHTML = data.programs.map(p => `
      <div class="program-card" onclick="window.location.href='/program?id=${p.id}'" style="cursor: pointer;">
        <div class="card-image">
          ${p.image 
            ? `<img src="${p.image}" alt="${escapeHtml(p.title)}" loading="lazy">` 
            : `<span class="placeholder-icon"><i class="fas fa-cube"></i></span>`
          }
        </div>
        <div class="card-body">
          <h3><a href="/program?id=${p.id}" class="card-title-link">${escapeHtml(p.title)}</a></h3>
          <p>${escapeHtml(p.description || 'No description available.')}</p>
          <div class="card-footer" style="justify-content: flex-end;">
            <a href="/program?id=${p.id}" class="download-btn" onclick="event.stopPropagation();">
              <i class="fas fa-eye"></i> View & Download
            </a>
          </div>
        </div>
      </div>
    `).join('');

    renderPagination(data.page, data.totalPages);
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    console.error('Failed to load programs:', err);
  }
}

// ============ PAGINATION ============
function renderPagination(page, totalPages) {
  const container = document.getElementById('pagination');
  if (!container || totalPages <= 1) {
    if (container) container.innerHTML = '';
    return;
  }

  let html = '';

  if (page > 1) {
    html += `<button class="page-btn" onclick="goToPage(${page - 1})"><i class="fas fa-chevron-left"></i></button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (i === page - 3 || i === page + 3) {
      html += `<span style="color:var(--text-dim);padding:8px;">...</span>`;
    }
  }

  if (page < totalPages) {
    html += `<button class="page-btn" onclick="goToPage(${page + 1})"><i class="fas fa-chevron-right"></i></button>`;
  }

  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadPrograms();
  window.scrollTo({ top: 300, behavior: 'smooth' });
}

// ============ HELPERS ============
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
