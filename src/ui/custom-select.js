// Custom dropdown component that wraps a native <select> element.
// Reads options/optgroups from the native select, renders a styled dropdown,
// and keeps the native select in sync (hidden).

export class CustomSelect {
  constructor(nativeSelect, onChange) {
    this._native = nativeSelect;
    this._onChange = onChange;
    this._isOpen = false;

    this._build();
    this._bindEvents();
  }

  _build() {
    const ns = this._native;
    ns.style.display = 'none';

    // Wrapper
    this._el = document.createElement('div');
    this._el.className = 'custom-select';
    ns.parentNode.insertBefore(this._el, ns);

    // Trigger
    this._trigger = document.createElement('div');
    this._trigger.className = 'custom-select-trigger';
    this._trigger.textContent = this._selectedText();
    this._el.appendChild(this._trigger);

    // Dropdown
    this._dropdown = document.createElement('div');
    this._dropdown.className = 'custom-select-dropdown';
    this._buildOptions();
    this._el.appendChild(this._dropdown);
  }

  _selectedText() {
    const opt = this._native.options[this._native.selectedIndex];
    return opt ? opt.textContent : '';
  }

  _buildOptions() {
    this._dropdown.innerHTML = '';
    const children = this._native.children;

    for (const child of children) {
      if (child.tagName === 'OPTGROUP') {
        const groupLabel = document.createElement('div');
        groupLabel.className = 'custom-select-group';
        groupLabel.textContent = child.label;
        this._dropdown.appendChild(groupLabel);

        for (const opt of child.children) {
          this._addOption(opt);
        }
      } else if (child.tagName === 'OPTION') {
        this._addOption(child);
      }
    }
  }

  _addOption(opt) {
    const el = document.createElement('div');
    el.className = 'custom-select-option';
    if (opt.value === this._native.value) el.classList.add('active');
    el.textContent = opt.textContent;
    el.dataset.value = opt.value;
    this._dropdown.appendChild(el);
  }

  _bindEvents() {
    this._trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });

    this._dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.custom-select-option');
      if (!option) return;
      this._select(option.dataset.value);
    });

    document.addEventListener('click', (e) => {
      if (this._isOpen && !this._el.contains(e.target)) {
        this._close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (this._isOpen && e.key === 'Escape') {
        this._close();
      }
    });
  }

  _toggle() {
    if (this._isOpen) {
      this._close();
    } else {
      this._open();
    }
  }

  _open() {
    this._isOpen = true;
    this._el.classList.add('open');
  }

  _close() {
    this._isOpen = false;
    this._el.classList.remove('open');
  }

  _select(value) {
    this._native.value = value;
    this._trigger.textContent = this._selectedText();
    this._close();

    // Update active state
    this._dropdown.querySelectorAll('.custom-select-option').forEach(el => {
      el.classList.toggle('active', el.dataset.value === value);
    });

    if (this._onChange) this._onChange(value);
  }

  // Programmatic value update (if needed externally)
  setValue(value) {
    this._native.value = value;
    this._trigger.textContent = this._selectedText();
    this._dropdown.querySelectorAll('.custom-select-option').forEach(el => {
      el.classList.toggle('active', el.dataset.value === value);
    });
  }
}
