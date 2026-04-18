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
                            'accountId'        => acct.get('account_id'),
                            'name'             => acct.get('name'),
                            'officialName'     => acct.get('official_name'),
                            'type'             => acct.get('type'),
                            'subtype'          => acct.get('subtype'),
                            'mask'             => acct.get('mask'),
                            'currentBalance'   => bal != null ? bal.get('current')   : null,
                            'availableBalance' => bal != null ? bal.get('available') : null
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

    @AuraEnabled(cacheable=true)
    public static Boolean hasActiveConnection() {
        String userId = UserInfo.getUserId();
        return [
            SELECT COUNT() FROM Plaid_Connection__c
            WHERE User__c = :userId AND Status__c = 'Active'
        ] > 0;
    }
}
