import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getConnectedAccounts from '@salesforce/apex/PlaidController.getConnectedAccounts';
import getTransactions     from '@salesforce/apex/PlaidController.getTransactions';

const USD       = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const PAGE_SIZE = 5;

function enrichTransaction(raw, idx) {
    const amount       = raw.amount != null ? Number(raw.amount) : 0;
    const pfc          = raw.personal_finance_category || {};
    const loc          = raw.location                  || {};
    const pm           = raw.payment_meta              || {};
    const counterparties = Array.isArray(raw.counterparties) ? raw.counterparties : [];
    const category     = Array.isArray(raw.category)  ? raw.category : [];

    const hasLocation    = !!(loc.address || loc.city || loc.country || loc.region);
    const hasPaymentMeta = !!(pm.reference_number || pm.ppd_id || pm.payee || pm.payer ||
                               pm.payment_method   || pm.payment_processor || pm.reason);

    return {
        ...raw,
        _idx:             idx,
        formattedAmount:  USD.format(Math.abs(amount)),
        // In Plaid: positive amount = money leaving account (debit), negative = credit
        amountClass:      amount > 0 ? 'amount amount-debit' : 'amount amount-credit',
        primaryCategory:  pfc.primary          || (category[0]  || ''),
        detailedCategory: pfc.detailed         || (category.slice(1).join(' › ') || '—'),
        categoryConfidence: pfc.confidence_level || '—',
        legacyCategory:   category.length ? category.join(' › ') : '—',
        // Location
        hasLocation,
        locationAddress:    loc.address      || '—',
        locationCity:       loc.city         || '—',
        locationRegion:     loc.region       || '—',
        locationPostalCode: loc.postal_code  || '—',
        locationCountry:    loc.country      || '—',
        locationStoreNumber: loc.store_number || '—',
        locationCoords:     (loc.lat != null && loc.lon != null) ? `${loc.lat}, ${loc.lon}` : '—',
        // Payment Meta
        hasPaymentMeta,
        pmReferenceNumber:  pm.reference_number  || '—',
        pmPpdId:            pm.ppd_id            || '—',
        pmPayee:            pm.payee             || '—',
        pmPayer:            pm.payer             || '—',
        pmPaymentMethod:    pm.payment_method    || '—',
        pmPaymentProcessor: pm.payment_processor || '—',
        pmReason:           pm.reason            || '—',
        // Counterparties
        hasCounterparties: counterparties.length > 0,
        counterpartiesDisplay: counterparties.map((cp, i) => ({ ...cp, _key: `cp-${idx}-${i}` })),
    };
}

export default class PlaidTransactions extends LightningElement {
    @track connections         = [];
    @track selectedBank        = '';
    @track selectedAccountId   = '';
    @track transactions        = [];
    @track currentPage         = 1;
    @track selectedTransaction = null;
    @track isLoading           = false;
    @track error               = null;
    @track searchDone          = false;

    connectedCallback() {
        this._loadBanks();
    }

    async _loadBanks() {
        try {
            this.isLoading = true;
            const raw = await getConnectedAccounts();

            const groupMap = new Map();
            (raw || []).forEach(conn => {
                const key = (conn.institutionName || 'Unknown Bank').toLowerCase().trim();
                if (!groupMap.has(key)) {
                    groupMap.set(key, {
                        label:    conn.institutionName || 'Unknown Bank',
                        value:    key,
                        accounts: [],
                    });
                }
                const group = groupMap.get(key);
                (conn.accounts || []).forEach(acct => {
                    group.accounts.push({ ...acct, connectionId: conn.connectionId });
                });
            });

            this.connections = Array.from(groupMap.values());
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    // ── Getters ───────────────────────────────────────────────

    get noBanksConnected() {
        return !this.isLoading && this.connections.length === 0;
    }

    get bankOptions() {
        return this.connections.map(c => ({ label: c.label, value: c.value }));
    }

    get _selectedBankObj() {
        return this.connections.find(c => c.value === this.selectedBank);
    }

    get accountOptions() {
        const bank = this._selectedBankObj;
        if (!bank) return [];
        return bank.accounts.map(a => ({
            label: `${a.name}${a.mask ? ' (••••' + a.mask + ')' : ''}`,
            value: a.accountId,
        }));
    }

    get isAccountDisabled() { return !this.selectedBank || this.isLoading; }

    get isShowDisabled() { return !this.selectedBank || !this.selectedAccountId || this.isLoading; }

    get hasTransactions() { return this.transactions.length > 0; }

    get showEmptyResult() { return this.searchDone && !this.isLoading && !this.hasTransactions; }

    get totalCount() { return this.transactions.length; }

    get totalPages() { return Math.max(1, Math.ceil(this.totalCount / PAGE_SIZE)); }

    get pageStart() { return (this.currentPage - 1) * PAGE_SIZE + 1; }

    get pageEnd() { return Math.min(this.currentPage * PAGE_SIZE, this.totalCount); }

    get pagedTransactions() {
        const start = (this.currentPage - 1) * PAGE_SIZE;
        return this.transactions.slice(start, start + PAGE_SIZE);
    }

    get isFirstPage() { return this.currentPage === 1; }

    get isLastPage() { return this.currentPage >= this.totalPages; }

    // ── Handlers ──────────────────────────────────────────────

    handleBankChange(event) {
        this.selectedBank      = event.detail.value;
        this.selectedAccountId = '';
        this.transactions      = [];
        this.searchDone        = false;
        this.currentPage       = 1;
        this.error             = null;
    }

    handleAccountChange(event) {
        this.selectedAccountId = event.detail.value;
        this.transactions      = [];
        this.searchDone        = false;
        this.currentPage       = 1;
        this.error             = null;
    }

    async handleShowTransactions() {
        const bank    = this._selectedBankObj;
        const account = bank?.accounts.find(a => a.accountId === this.selectedAccountId);
        if (!account) return;

        try {
            this.isLoading    = true;
            this.error        = null;
            this.transactions = [];
            this.currentPage  = 1;
            this.searchDone   = false;

            const raw = await getTransactions({
                connectionId: account.connectionId,
                accountId:    this.selectedAccountId,
            });

            this.transactions = (raw || []).map(enrichTransaction);
            this.searchDone   = true;
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    handleRowClick(event) {
        const id = event.currentTarget.dataset.txnId;
        this.selectedTransaction = this.transactions.find(t => t.transaction_id === id) || null;
    }

    handleCloseModal() {
        this.selectedTransaction = null;
    }

    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }

    handleNextPage() { if (!this.isLastPage) this.currentPage++; }

    clearError() { this.error = null; }

    _handleError(err) {
        const msg = err?.body?.message || err?.message || 'An unexpected error occurred.';
        this.error = msg;
        this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
    }
}
