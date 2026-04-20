public with sharing class PlaidService {

    private static final String BASE_URL;
    private static final String CLIENT_ID;
    private static final String SECRET;

    static {
        Plaid_Config__mdt config = [
            SELECT Client_Id__c, Secret__c, Environment_URL__c
            FROM Plaid_Config__mdt
            WHERE DeveloperName = 'Default'
            LIMIT 1
        ];
        BASE_URL = config.Environment_URL__c;
        CLIENT_ID = config.Client_Id__c;
        SECRET = config.Secret__c;
    }

    public static Map<String, Object> createLinkToken(String userId) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id' => CLIENT_ID,
            'secret' => SECRET,
            'client_name' => 'Plaid Salesforce Integration',
            'language' => 'en',
            'products' => new List<String>{ 'transactions', 'identity', 'auth' },
            'country_codes' => new List<String>{ 'US' },
            'user' => new Map<String, Object>{ 'client_user_id' => userId }
        };
        return callPlaid('/link/token/create', body);
    }

    public static Map<String, Object> exchangePublicToken(String publicToken) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id' => CLIENT_ID,
            'secret' => SECRET,
            'public_token' => publicToken
        };
        return callPlaid('/item/public_token/exchange', body);
    }

    public static Map<String, Object> getAccounts(String accessToken) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id' => CLIENT_ID,
            'secret' => SECRET,
            'access_token' => accessToken
        };
        return callPlaid('/accounts/get', body);
    }

    public static Map<String, Object> getAuth(String accessToken, String accountId) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id'    => CLIENT_ID,
            'secret'       => SECRET,
            'access_token' => accessToken,
            'options'      => new Map<String, Object>{
                'account_ids' => new List<String>{ accountId }
            }
        };
        return callPlaid('/auth/get', body);
    }

    public static Map<String, Object> getIdentity(String accessToken, String accountId) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id'    => CLIENT_ID,
            'secret'       => SECRET,
            'access_token' => accessToken,
            'options'      => new Map<String, Object>{
                'account_ids' => new List<String>{ accountId }
            }
        };
        return callPlaid('/identity/get', body);
    }

    public static Map<String, Object> syncTransactions(String accessToken, String cursor, String accountId) {
        Map<String, Object> options = new Map<String, Object>{
            'include_personal_finance_category' => true
        };
        if (String.isNotBlank(accountId)) {
            options.put('account_id', accountId);
        }
        Map<String, Object> body = new Map<String, Object>{
            'client_id'    => CLIENT_ID,
            'secret'       => SECRET,
            'access_token' => accessToken,
            'count'        => 500,
            'options'      => options
        };
        if (String.isNotBlank(cursor)) {
            body.put('cursor', cursor);
        }
        return callPlaid('/transactions/sync', body);
    }

    public static Map<String, Object> createTransferAuthorization(
        String accessToken, String accountId, String type, String network,
        String amount, String achClass, String legalName, String emailAddress, String phoneNumber
    ) {
        Map<String, Object> user = new Map<String, Object>{ 'legal_name' => legalName };
        if (String.isNotBlank(emailAddress)) user.put('email_address', emailAddress);
        if (String.isNotBlank(phoneNumber))  user.put('phone_number',  phoneNumber);

        Map<String, Object> body = new Map<String, Object>{
            'client_id'    => CLIENT_ID,
            'secret'       => SECRET,
            'access_token' => accessToken,
            'account_id'   => accountId,
            'type'         => type,
            'network'      => network,
            'amount'       => amount,
            'ach_class'    => achClass,
            'user'         => user
        };

        return callPlaid('/transfer/authorization/create', body);
    }

    public static Map<String, Object> createTransfer(
        String accessToken, String accountId, String authorizationId, String description
    ) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id'        => CLIENT_ID,
            'secret'           => SECRET,
            'access_token'     => accessToken,
            'account_id'       => accountId,
            'authorization_id' => authorizationId,
            'description'      => description
        };
        return callPlaid('/transfer/create', body);
    }

    public static Map<String, Object> migrateAccount(String accountNumber, String routingNumber, String accountType) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id'      => CLIENT_ID,
            'secret'         => SECRET,
            'account_number' => accountNumber,
            'routing_number' => routingNumber,
            'account_type'   => accountType
        };
        return callPlaid('/transfer/migrate_account', body);
    }

    public static Map<String, Object> removeItem(String accessToken) {
        Map<String, Object> body = new Map<String, Object>{
            'client_id' => CLIENT_ID,
            'secret' => SECRET,
            'access_token' => accessToken
        };
        return callPlaid('/item/remove', body);
    }

    private static Map<String, Object> callPlaid(String endpoint, Map<String, Object> body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + endpoint);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(body));
        req.setTimeout(30000);
        system.debug(JSON.serialize(body));
        HttpResponse res = new Http().send(req);
        Map<String, Object> responseMap = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        if (res.getStatusCode() != 200) {
            String errorMsg = (String) responseMap.get('error_message');
            if (String.isBlank(errorMsg)) {
                errorMsg = 'Plaid API error: ' + res.getStatus();
            }
            throw new PlaidException(errorMsg);
        }
        system.debug(json.serialize(responseMap));
        return responseMap;
    }

    public class PlaidException extends Exception {}
}
