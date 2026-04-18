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
            'products' => new List<String>{ 'transactions' },
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

        HttpResponse res = new Http().send(req);
        Map<String, Object> responseMap = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

        if (res.getStatusCode() != 200) {
            String errorMsg = (String) responseMap.get('error_message');
            if (String.isBlank(errorMsg)) {
                errorMsg = 'Plaid API error: ' + res.getStatus();
            }
            throw new PlaidException(errorMsg);
        }

        return responseMap;
    }

    public class PlaidException extends Exception {}
}
