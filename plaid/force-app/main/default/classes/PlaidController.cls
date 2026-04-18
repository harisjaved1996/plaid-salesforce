public with sharing class PlaidController {

    @AuraEnabled
    public static String getLinkToken() {
        try {
            Map<String, Object> response = PlaidService.createLinkToken(UserInfo.getUserId());
            return (String) response.get('link_token');
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void exchangePublicToken(String publicToken, String institutionName) {
        try {
            Map<String, Object> response = PlaidService.exchangePublicToken(publicToken);
            String userId = UserInfo.getUserId();

            // Always insert — each Plaid Link session is a separate Item/connection
            insert new Plaid_Connection__c(
                User__c             = userId,
                Access_Token__c     = (String) response.get('access_token'),
                Item_Id__c          = (String) response.get('item_id'),
                Institution_Name__c = institutionName,
                Status__c           = 'Active'
            );
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    // Returns one entry per active connection, each with its own accounts list.
    @AuraEnabled
    public static List<Map<String, Object>> getConnectedAccounts() {
        try {
            String userId = UserInfo.getUserId();
            List<Plaid_Connection__c> connections = [
                SELECT Id, Access_Token__c, Institution_Name__c
                FROM Plaid_Connection__c
                WHERE User__c = :userId AND Status__c = 'Active'
                ORDER BY CreatedDate ASC
            ];

            List<Map<String, Object>> result = new List<Map<String, Object>>();

            for (Plaid_Connection__c conn : connections) {
                List<Map<String, Object>> accounts = new List<Map<String, Object>>();
                try {
                    Map<String, Object> plaidResp = PlaidService.getAccounts(conn.Access_Token__c);
                    for (Object raw : (List<Object>) plaidResp.get('accounts')) {
                        Map<String, Object> acct = (Map<String, Object>) raw;
                        Map<String, Object> bal  = (Map<String, Object>) acct.get('balances');
                        accounts.add(new Map<String, Object>{
                            'accountId'              => acct.get('account_id'),
                            'name'                   => acct.get('name'),
                            'officialName'           => acct.get('official_name'),
                            'type'                   => acct.get('type'),
                            'subtype'                => acct.get('subtype'),
                            'mask'                   => acct.get('mask'),
                            'currentBalance'         => bal != null ? bal.get('current')                  : null,
                            'availableBalance'       => bal != null ? bal.get('available')                : null,
                            'limit'                  => bal != null ? bal.get('limit')                    : null,
                            'isoCurrencyCode'        => bal != null ? bal.get('iso_currency_code')        : null,
                            'unofficialCurrencyCode' => bal != null ? bal.get('unofficial_currency_code') : null,
                            'persistentAccountId'    => acct.get('persistent_account_id'),
                            'verificationStatus'     => acct.get('verification_status')
                        });
                    }
                } catch (Exception ignored) {}

                result.add(new Map<String, Object>{
                    'connectionId'    => conn.Id,
                    'institutionName' => conn.Institution_Name__c,
                    'accounts'        => accounts
                });
            }

            return result;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static Map<String, Object> getIdentity(String connectionId, String accountId) {
        try {
            String userId = UserInfo.getUserId();
            Plaid_Connection__c conn = [
                SELECT Id, Access_Token__c
                FROM Plaid_Connection__c
                WHERE Id = :connectionId AND User__c = :userId AND Status__c = 'Active'
                LIMIT 1
            ];

            Map<String, Object> response = PlaidService.getIdentity(conn.Access_Token__c);
            List<Object> accounts = (List<Object>) response.get('accounts');

            for (Object rawAcct : accounts) {
                Map<String, Object> acct = (Map<String, Object>) rawAcct;
                if (!accountId.equals((String) acct.get('account_id'))) continue;

                List<Object> rawOwners = (List<Object>) acct.get('owners');
                List<Map<String, Object>> owners = new List<Map<String, Object>>();

                if (rawOwners != null) {
                    for (Object rawOwner : rawOwners) {
                        Map<String, Object> owner = (Map<String, Object>) rawOwner;

                        // Names
                        List<String> names = new List<String>();
                        List<Object> rawNames = (List<Object>) owner.get('names');
                        if (rawNames != null) {
                            for (Object n : rawNames) names.add((String) n);
                        }

                        // Emails
                        List<Map<String, Object>> emails = new List<Map<String, Object>>();
                        List<Object> rawEmails = (List<Object>) owner.get('emails');
                        if (rawEmails != null) {
                            for (Object re : rawEmails) {
                                Map<String, Object> e = (Map<String, Object>) re;
                                emails.add(new Map<String, Object>{
                                    'data' => e.get('data'), 'primary' => e.get('primary'), 'type' => e.get('type')
                                });
                            }
                        }

                        // Phone numbers
                        List<Map<String, Object>> phones = new List<Map<String, Object>>();
                        List<Object> rawPhones = (List<Object>) owner.get('phone_numbers');
                        if (rawPhones != null) {
                            for (Object rp : rawPhones) {
                                Map<String, Object> p = (Map<String, Object>) rp;
                                phones.add(new Map<String, Object>{
                                    'data' => p.get('data'), 'primary' => p.get('primary'), 'type' => p.get('type')
                                });
                            }
                        }

                        // Addresses
                        List<Map<String, Object>> addresses = new List<Map<String, Object>>();
                        List<Object> rawAddresses = (List<Object>) owner.get('addresses');
                        if (rawAddresses != null) {
                            for (Object ra : rawAddresses) {
                                Map<String, Object> addr     = (Map<String, Object>) ra;
                                Map<String, Object> addrData = (Map<String, Object>) addr.get('data');
                                addresses.add(new Map<String, Object>{
                                    'primary'    => addr.get('primary'),
                                    'street'     => addrData != null ? addrData.get('street')      : null,
                                    'city'       => addrData != null ? addrData.get('city')        : null,
                                    'region'     => addrData != null ? addrData.get('region')      : null,
                                    'postalCode' => addrData != null ? addrData.get('postal_code') : null,
                                    'country'    => addrData != null ? addrData.get('country')     : null
                                });
                            }
                        }

                        owners.add(new Map<String, Object>{
                            'names'     => names,
                            'emails'    => emails,
                            'phones'    => phones,
                            'addresses' => addresses
                        });
                    }
                }

                return new Map<String, Object>{
                    'accountId'   => acct.get('account_id'),
                    'accountName' => acct.get('name'),
                    'owners'      => owners
                };
            }

            throw new AuraHandledException('Account not found in identity response.');
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void disconnectBank(String connectionId) {
        try {
            String userId = UserInfo.getUserId();
            Plaid_Connection__c conn = [
                SELECT Id, Access_Token__c
                FROM Plaid_Connection__c
                WHERE Id = :connectionId AND User__c = :userId AND Status__c = 'Active'
                LIMIT 1
            ];

            try {
                PlaidService.removeItem(conn.Access_Token__c);
            } catch (Exception ignored) {}

            conn.Status__c     = 'Disconnected';
            conn.Access_Token__c = null;
            update conn;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static List<Map<String, Object>> getTransactions(String connectionId, String accountId) {
        try {
            String userId = UserInfo.getUserId();
            Plaid_Connection__c conn = [
                SELECT Id, Access_Token__c
                FROM Plaid_Connection__c
                WHERE Id = :connectionId AND User__c = :userId AND Status__c = 'Active'
                LIMIT 1
            ];

            // transactions/sync does not support account_ids filtering — fetch all and filter here
            List<Map<String, Object>> allTransactions = new List<Map<String, Object>>();
            String cursor  = null;
            Boolean hasMore = true;
            Integer maxCallouts = 5;

            while (hasMore && maxCallouts > 0) {
                Map<String, Object> response = PlaidService.syncTransactions(conn.Access_Token__c, cursor);
                List<Object> added = (List<Object>) response.get('added');
                if (added != null) {
                    for (Object raw : added) {
                        Map<String, Object> txn = (Map<String, Object>) raw;
                        if (String.isBlank(accountId) || accountId.equals((String) txn.get('account_id'))) {
                            allTransactions.add(txn);
                        }
                    }
                }
                cursor  = (String) response.get('next_cursor');
                Object hm = response.get('has_more');
                hasMore = (hm instanceof Boolean) && (Boolean) hm;
                maxCallouts--;
            }

            List<TxnWrapper> wrapped = new List<TxnWrapper>();
            for (Map<String, Object> t : allTransactions) {
                wrapped.add(new TxnWrapper(t));
            }
            wrapped.sort();

            List<Map<String, Object>> sorted = new List<Map<String, Object>>();
            for (TxnWrapper w : wrapped) {
                sorted.add(w.data);
            }
            return sorted;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private class TxnWrapper implements Comparable {
        public Map<String, Object> data;
        private Date txnDate;

        public TxnWrapper(Map<String, Object> d) {
            this.data = d;
            String ds = (String) d.get('date');
            this.txnDate = String.isNotBlank(ds) ? Date.valueOf(ds) : Date.newInstance(1900, 1, 1);
        }

        public Integer compareTo(Object other) {
            TxnWrapper o = (TxnWrapper) other;
            if (this.txnDate > o.txnDate) return -1;
            if (this.txnDate < o.txnDate) return 1;
            return 0;
        }
    }

    @AuraEnabled(cacheable=true)
    public static Boolean hasActiveConnection() {
        String userId = UserInfo.getUserId();
        return [
            SELECT COUNT() FROM Plaid_Connection__c
            WHERE User__c = :userId AND Status__c = 'Active'
        ] > 0;
    }
}
