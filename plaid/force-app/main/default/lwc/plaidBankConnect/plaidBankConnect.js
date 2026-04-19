import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';

import PLAID_SDK from '@salesforce/resourceUrl/PlaidSDK';

import getLinkToken         from '@salesforce/apex/PlaidController.getLinkToken';
import exchangePublicToken  from '@salesforce/apex/PlaidController.exchangePublicToken';
import getConnectedAccounts from '@salesforce/apex/PlaidController.getConnectedAccounts';
import getAuth              from '@salesforce/apex/PlaidController.getAuth';
import getIdentity          from '@salesforce/apex/PlaidController.getIdentity';
import createTransfer       from '@salesforce/apex/PlaidController.createTransfer';
import getTransactions      from '@salesforce/apex/PlaidController.getTransactions';
import disconnectBank       from '@salesforce/apex/PlaidController.disconnectBank';
import hasActiveConnection  from '@salesforce/apex/PlaidController.hasActiveConnection';

// ── Constants ─────────────────────────────────────────────────
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const GRADIENTS = [
    'linear-gradient(135deg,#0070d2,#032d60)',
    'linear-gradient(135deg,#7c3aed,#4c1d95)',
    'linear-gradient(135deg,#059669,#064e3b)',
    'linear-gradient(135deg,#dc2626,#7f1d1d)',
    'linear-gradient(135deg,#d97706,#78350f)',
    'linear-gradient(135deg,#0891b2,#164e63)',
    'linear-gradient(135deg,#db2777,#831843)',
    'linear-gradient(135deg,#65a30d,#365314)',
];

const ICON_BG = {
    depository: 'linear-gradient(135deg,#0070d2,#005fb2)',
    credit:     'linear-gradient(135deg,#dc2626,#b91c1c)',
    investment: 'linear-gradient(135deg,#059669,#047857)',
    loan:       'linear-gradient(135deg,#d97706,#b45309)',
    other:      'linear-gradient(135deg,#6b7280,#4b5563)',
};

const ICONS = {
    depository: 'utility:money',
    credit:     'utility:credit_card',
    investment: 'utility:chart',
    loan:       'utility:home',
    other:      'utility:account',
};

const CHIPS = {
    checking:      'chip chip-checking',
    savings:       'chip chip-savings',
    depository:    'chip chip-depository',
    'credit card': 'chip chip-credit',
    credit:        'chip chip-credit',
    investment:    'chip chip-investment',
    loan:          'chip chip-loan',
    mortgage:      'chip chip-mortgage',
};

// ── Helpers ───────────────────────────────────────────────────
function hashGradient(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

function enrichAccount(raw) {
    const type    = (raw.type    || 'other').toLowerCase();
    const subtype = (raw.subtype || '').toLowerCase();
    return {
        ...raw,
        iconName:                  ICONS[type]    || ICONS.other,
        iconStyle:                 `background:${ICON_BG[type] || ICON_BG.other}`,
        chipClass:                 CHIPS[subtype] || CHIPS[type] || 'chip chip-other',
        formattedCurrentBalance:   raw.currentBalance   != null ? USD.format(raw.currentBalance)   : '—',
        formattedAvailableBalance: raw.availableBalance != null ? USD.format(raw.availableBalance) : '—',
        formattedLimitBalance:     raw.limit            != null ? USD.format(raw.limit)            : '—',
        currencyCode:              raw.isoCurrencyCode || raw.unofficialCurrencyCode || 'USD',
        confirmingDelete: false,
    };
}

function cardClasses(isExpanded) {
    return {
        headerClass:       `bank-header${isExpanded ? ' bank-header--expanded' : ''}`,
        chevronClass:      `chevron${isExpanded ? ' chevron--open' : ''}`,
        accountsWrapClass: `accounts-wrap${isExpanded ? '' : ' accounts-wrap--closed'}`,
    };
}

// ── Component ─────────────────────────────────────────────────
export default class PlaidBankConnect extends LightningElement {
    @track connections      = [];
    @track isLoading        = true;
    @track error            = null;
    @track selectedAccount  = null;
    @track identityData      = null;
    @track isLoadingIdentity = false;
    @track authData              = null;
    @track isLoadingAuth         = false;

    // ── Transfer Modal state ──────────────────────────────────
    @track isTransferModalOpen      = false;
    @track transferSourceAccount    = null;
    @track sourceLegalName          = '';
    @track selectedDestAccountId    = '';
    @track selectedDestConnectionId = '';
    @track destLegalName            = '';
    @track transferAmount           = '';
    @track transferNetwork          = 'ach';
    @track transferAchClass         = 'ppd';
    @track transferDescription      = '';
    @track isSubmittingTransfer     = false;
    @track transferResult           = null;

    // ── Transactions Modal state ──────────────────────────────
    @track isTransactionsModalOpen  = false;
    @track isLoadingTransactions    = false;
    @track transactionSourceAccount = null;
    @track transactions             = [];

    _plaidInitialized = false;

    connectedCallback() {
        this._init();
    }

    async _init() {
        try {
            this.isLoading = true;
            if (await hasActiveConnection()) await this._loadAccounts();
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    async _loadAccounts() {
        const raw = await getConnectedAccounts();

        const prevExpanded = new Map(this.connections.map(c => [c.groupKey, c.isExpanded]));

        const groupMap = new Map();
        (raw || []).forEach(conn => {
            const key = (conn.institutionName || 'Unknown Bank').toLowerCase().trim();
            if (!groupMap.has(key)) {
                groupMap.set(key, {
                    groupKey:        key,
                    institutionName: conn.institutionName || 'Unknown Bank',
                    connectionIds:   [],
                    accounts:        [],
                });
            }
            const group = groupMap.get(key);
            group.connectionIds.push(conn.connectionId);
            (conn.accounts || []).forEach(acct =>
                group.accounts.push(enrichAccount({ ...acct, connectionId: conn.connectionId }))
            );
        });

        this.connections = Array.from(groupMap.values()).map(group => {
            const isExpanded = prevExpanded.get(group.groupKey) ?? true;
            return {
                ...group,
                institutionInitial:   group.institutionName.charAt(0).toUpperCase(),
                avatarStyle:          `background:${hashGradient(group.institutionName)}`,
                accountCount:         group.accounts.length,
                isExpanded,
                confirmingBankRemove: false,
                ...cardClasses(isExpanded),
            };
        });
    }

    // ── Plaid Link ────────────────────────────────────────────
    async handleConnectBank() {
        try {
            this.isLoading = true;
            this.error = null;
            const linkToken = await getLinkToken();
            await this._loadPlaidScript();
            this._openPlaidLink(linkToken);
        } catch (err) {
            this._handleError(err);
            this.isLoading = false;
        }
    }

    async _loadPlaidScript() {
        if (this._plaidInitialized) return;
        await loadScript(this, PLAID_SDK);
        if (!window.Plaid) throw new Error('Plaid SDK loaded but window.Plaid is undefined.');
        this._plaidInitialized = true;
    }

    _openPlaidLink(linkToken) {
        this._plaidHandler = window.Plaid.create({
            token:     linkToken,
            onSuccess: (pt, meta) => this._onSuccess(pt, meta),
            onExit:    (err) => {
                this.isLoading = false;
                if (err) this._handleError({ message: err.display_message || 'Link closed with an error.' });
            },
            onLoad: () => { this.isLoading = false; },
        });
        this._plaidHandler.open();
    }

    async _onSuccess(publicToken, metadata) {
        try {
            this.isLoading = true;
            await exchangePublicToken({ publicToken, institutionName: metadata?.institution?.name ?? '' });
            await this._loadAccounts();
            this._showToast('Success', `${metadata?.institution?.name || 'Bank'} connected!`, 'success');
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    // ── Expand / Collapse ─────────────────────────────────────
    handleToggle(event) {
        const key = event.currentTarget.dataset.groupKey;
        this.connections = this.connections.map(c => {
            if (c.groupKey !== key) return c;
            const isExpanded = !c.isExpanded;
            return { ...c, isExpanded, ...cardClasses(isExpanded) };
        });
    }

    // ── Bank-level Remove ─────────────────────────────────────
    handleBankRemoveClick(event) {
        event.stopPropagation();
        this._setGroupProp(event.currentTarget.dataset.groupKey, 'confirmingBankRemove', true);
    }

    handleBankCancelRemove(event) {
        event.stopPropagation();
        this._setGroupProp(event.currentTarget.dataset.groupKey, 'confirmingBankRemove', false);
    }

    async handleBankConfirmRemove(event) {
        event.stopPropagation();
        const key   = event.currentTarget.dataset.groupKey;
        const group = this.connections.find(c => c.groupKey === key);
        if (!group) return;
        try {
            this.isLoading = true;
            for (const connId of group.connectionIds) {
                await disconnectBank({ connectionId: connId }); // eslint-disable-line no-await-in-loop
            }
            this.connections = this.connections.filter(c => c.groupKey !== key);
            this._showToast('Success', `${group.institutionName} fully disconnected.`, 'success');
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    // ── Account-level Remove ──────────────────────────────────
    handleDeleteClick(event) {
        event.stopPropagation();
        const { groupKey, accountId } = event.currentTarget.dataset;
        this._setAccountProp(groupKey, accountId, 'confirmingDelete', true);
    }

    handleCancelDelete(event) {
        event.stopPropagation();
        const { groupKey, accountId } = event.currentTarget.dataset;
        this._setAccountProp(groupKey, accountId, 'confirmingDelete', false);
    }

    async handleConfirmDelete(event) {
        event.stopPropagation();
        const { groupKey, accountId } = event.currentTarget.dataset;
        const group   = this.connections.find(c => c.groupKey === groupKey);
        const account = group?.accounts.find(a => a.accountId === accountId);
        if (!account) return;
        try {
            this.isLoading = true;
            await disconnectBank({ connectionId: account.connectionId });

            this.connections = this.connections
                .map(c => {
                    if (c.groupKey !== groupKey) return c;
                    const accounts = c.accounts.filter(a => a.connectionId !== account.connectionId);
                    const connectionIds = c.connectionIds.filter(id => id !== account.connectionId);
                    return { ...c, accounts, connectionIds, accountCount: accounts.length };
                })
                .filter(c => c.accounts.length > 0);

            this._showToast('Success', `${account.name} disconnected.`, 'success');
        } catch (err) {
            this._handleError(err);
        } finally {
            this.isLoading = false;
        }
    }

    // ── Account Detail Modal ──────────────────────────────────
    handleGetAccount(event) {
        event.stopPropagation();
        const { groupKey, accountId } = event.currentTarget.dataset;
        const group   = this.connections.find(c => c.groupKey === groupKey);
        const account = group?.accounts.find(a => a.accountId === accountId);
        if (account) this.selectedAccount = account;
    }

    handleCloseModal() {
        this.selectedAccount = null;
    }

    // ── Identity Modal ────────────────────────────────────────
    async handleGetIdentity(event) {
        event.stopPropagation();
        const { groupKey, accountId, connectionId } = event.currentTarget.dataset;
        try {
            this.isLoadingIdentity = true;
            const raw = await getIdentity({ connectionId, accountId });

            const owners = (raw.owners || []).map((owner, oi) => ({
                ownerKey: `owner-${oi}`,
                names: (owner.names || []).map((name, ni) => ({ key: `n-${oi}-${ni}`, value: name })),
                emails: (owner.emails || []).map((e, ei) => ({ ...e, key: `e-${oi}-${ei}` })),
                phones: (owner.phones || []).map((p, pi) => ({ ...p, key: `p-${oi}-${pi}` })),
                addresses: (owner.addresses || []).map((a, ai) => ({
                    ...a,
                    key: `a-${oi}-${ai}`,
                    formatted: [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', '),
                })),
            }));

            const group   = this.connections.find(c => c.groupKey === groupKey);
            const account = group?.accounts.find(a => a.accountId === accountId);

            this.identityData = { ...raw, owners, account };
        } catch (err) {
            const msg = err?.body?.message || err?.message || '';
            if (msg.includes('PRODUCT_IDENTITY') || msg.includes('user consent') || msg.includes('product_not_ready')) {
                this._handleError({ message: 'Identity is not enabled for this bank connection. Please click "Remove Bank" and re-connect the bank to activate Identity.' });
            } else {
                this._handleError(err);
            }
        } finally {
            this.isLoadingIdentity = false;
        }
    }

    handleCloseIdentityModal() {
        this.identityData = null;
    }

    // ── Auth Modal ────────────────────────────────────────────
    async handleGetAuth(event) {
        event.stopPropagation();
        const { connectionId, accountId } = event.currentTarget.dataset;
        try {
            this.isLoadingAuth = true;
            const raw = await getAuth({ connectionId, accountId });
            this.authData = raw;
        } catch (err) {
            const msg = err?.body?.message || err?.message || '';
            if (msg.includes('PRODUCT_AUTH') || msg.includes('user consent') || msg.includes('product_not_ready')) {
                this._handleError({ message: 'Auth is not enabled for this bank connection. Please click "Remove Bank" and re-connect the bank to activate Auth.' });
            } else {
                this._handleError(err);
            }
        } finally {
            this.isLoadingAuth = false;
        }
    }

    handleCloseAuthModal() {
        this.authData = null;
    }

    // ── Transfer Modal ────────────────────────────────────────
    async handleSendTransfer(event) {
        event.stopPropagation();
        const { connectionId, accountId, groupKey } = event.currentTarget.dataset;
        const group   = this.connections.find(c => c.groupKey === groupKey);
        const account = group?.accounts.find(a => a.accountId === accountId);

        this.transferSourceAccount    = {
            connectionId, accountId,
            name:            account?.name          || 'Account',
            mask:            account?.mask          || '',
            institutionName: group?.institutionName || '',
            iconName:        account?.iconName      || 'utility:money',
        };
        this.sourceLegalName          = '';
        this.selectedDestAccountId    = '';
        this.selectedDestConnectionId = '';
        this.destLegalName            = '';
        this.transferAmount           = '';
        this.transferNetwork          = 'ach';
        this.transferAchClass         = 'ppd';
        this.transferDescription      = '';
        this.transferResult           = null;
        this.isTransferModalOpen      = true;

        try {
            const raw = await getIdentity({ connectionId, accountId });
            this.sourceLegalName = raw?.owners?.[0]?.names?.[0] || '';
        } catch (e) { /* identity not enabled */ }
    }

    handleDestAccountChange(event) {
        const accountId = event.target.value;
        if (!accountId) {
            this.selectedDestAccountId    = '';
            this.selectedDestConnectionId = '';
            this.destLegalName            = '';
            return;
        }
        let foundConnectionId = '';
        for (const conn of this.connections) {
            const acct = conn.accounts.find(a => a.accountId === accountId);
            if (acct) { foundConnectionId = acct.connectionId; break; }
        }
        this.selectedDestAccountId    = accountId;
        this.selectedDestConnectionId = foundConnectionId;
        this.destLegalName            = '';
        this._fetchDestIdentity(foundConnectionId, accountId);
    }

    async _fetchDestIdentity(connectionId, accountId) {
        try {
            const raw = await getIdentity({ connectionId, accountId });
            this.destLegalName = raw?.owners?.[0]?.names?.[0] || '';
        } catch (e) { /* silently fail */ }
    }

    handleTransferFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        this[field] = event.target.value;
    }

    handleCloseTransferModal() {
        this.isTransferModalOpen = false;
        this.transferResult      = null;
    }

    async handleSubmitTransfer() {
        if (!this.selectedDestAccountId) {
            this._showToast('Error', 'Please select a destination account.', 'error');
            return;
        }
        const amt = parseFloat(this.transferAmount);
        if (!amt || amt <= 0) {
            this._showToast('Error', 'Please enter a valid amount greater than 0.', 'error');
            return;
        }
        this.isSubmittingTransfer = true;
        this.transferResult       = null;
        try {
            const res = await createTransfer({
                sourceConnectionId: this.transferSourceAccount.connectionId,
                sourceAccountId:    this.transferSourceAccount.accountId,
                destConnectionId:   this.selectedDestConnectionId,
                destAccountId:      this.selectedDestAccountId,
                network:            this.transferNetwork,
                amount:             amt.toFixed(2),
                achClass:           this.transferAchClass,
                description:        (this.transferDescription || 'Transfer').substring(0, 10),
                sourceLegalName:    this.sourceLegalName || 'Account Holder',
                destLegalName:      this.destLegalName   || 'Account Holder',
            });
            this.transferResult = {
                success:          true,
                label:            `$${amt.toFixed(2)} transfer initiated successfully`,
                debitTransferId:  res.debitTransferId,
                debitStatus:      res.debitStatus,
                creditTransferId: res.creditTransferId,
                creditStatus:     res.creditStatus,
            };
            this._showToast('Success', `Transfer of $${amt.toFixed(2)} initiated.`, 'success');
        } catch (err) {
            const msg = err?.body?.message || err?.message || 'Transfer failed';
            this.transferResult = { success: false, error: msg };
        } finally {
            this.isSubmittingTransfer = false;
        }
    }

    // ── Transactions Modal ────────────────────────────────────
    async handleViewTransactions(event) {
        event.stopPropagation();
        const { connectionId, accountId, groupKey } = event.currentTarget.dataset;
        const group   = this.connections.find(c => c.groupKey === groupKey);
        const account = group?.accounts.find(a => a.accountId === accountId);

        this.transactionSourceAccount = {
            connectionId, accountId,
            name:            account?.name          || 'Account',
            mask:            account?.mask          || '',
            institutionName: group?.institutionName || '',
        };
        this.transactions            = [];
        this.isTransactionsModalOpen = true;
        this.isLoadingTransactions   = true;

        try {
            const raw = await getTransactions({ connectionId, accountId });
            this.transactions = (raw || []).map((t, i) => {
                const amount  = parseFloat(t.amount) || 0;
                const isDebit = amount > 0;
                return {
                    key:          t.transaction_id || `txn-${i}`,
                    date:         t.date,
                    name:         t.merchant_name || t.name,
                    formattedAmt: `${isDebit ? '-' : '+'}$${Math.abs(amount).toFixed(2)}`,
                    amountClass:  isDebit ? 'txn-amount txn-debit' : 'txn-amount txn-credit',
                };
            });
        } catch (err) {
            this._handleError(err);
            this.isTransactionsModalOpen = false;
        } finally {
            this.isLoadingTransactions = false;
        }
    }

    handleCloseTransactionsModal() {
        this.isTransactionsModalOpen = false;
        this.transactions            = [];
    }

    // ── Getters ───────────────────────────────────────────────
    get isConnected() { return this.connections && this.connections.length > 0; }

    get hasSelectedAccount()  { return !!this.selectedAccount; }
    get hasIdentityData()     { return !!this.identityData; }
    get hasAuthData()         { return !!this.authData; }
    get hasTransferResult()   { return !!this.transferResult; }
    get hasTransactions()     { return this.transactions && this.transactions.length > 0; }
    get noTransactions()      { return !this.isLoadingTransactions && (!this.transactions || this.transactions.length === 0); }

    get connectButtonLabel() { return this.isConnected ? 'Add Another Bank' : 'Connect Bank'; }

    get grandTotal() {
        const t = this.connections.reduce(
            (sum, c) => sum + c.accounts.reduce((s, a) => s + (a.currentBalance || 0), 0), 0
        );
        return USD.format(t);
    }

    get totalAccountCount() {
        return this.connections.reduce((sum, c) => sum + c.accounts.length, 0);
    }

    get destinationAccounts() {
        const srcId = this.transferSourceAccount?.accountId;
        const opts  = [];
        (this.connections || []).forEach(conn => {
            (conn.accounts || []).forEach(acct => {
                if (acct.accountId !== srcId) {
                    opts.push({
                        value: acct.accountId,
                        label: `${conn.institutionName} · ${acct.name} ••••${acct.mask}`,
                    });
                }
            });
        });
        return opts;
    }

    get hasDestinationAccounts() { return this.destinationAccounts.length > 0; }

    get selectedDestAccount() {
        if (!this.selectedDestAccountId) return null;
        for (const conn of this.connections) {
            const acct = conn.accounts.find(a => a.accountId === this.selectedDestAccountId);
            if (acct) return { ...acct, institutionName: conn.institutionName };
        }
        return null;
    }

    // ── Utilities ─────────────────────────────────────────────
    clearError() { this.error = null; }

    _setGroupProp(groupKey, prop, value) {
        this.connections = this.connections.map(c =>
            c.groupKey === groupKey ? { ...c, [prop]: value } : c
        );
    }

    _setAccountProp(groupKey, accountId, prop, value) {
        this.connections = this.connections.map(c => {
            if (c.groupKey !== groupKey) return c;
            return { ...c, accounts: c.accounts.map(a =>
                a.accountId === accountId ? { ...a, [prop]: value } : a
            )};
        });
    }

    _handleError(err) {
        const msg = err?.body?.message || err?.message || 'An unexpected error occurred.';
        this.error = msg;
        this._showToast('Error', msg, 'error');
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
