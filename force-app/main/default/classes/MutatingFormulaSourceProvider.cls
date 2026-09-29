/** Test provider that changes the record used by subsequent inclusion formulas. */
@isTest
public class MutatingFormulaSourceProvider implements DocgenDataProvider {
    public Map<String, Object> buildData(
        Id recordId,
        Docgen_Template__c template,
        String locale,
        String timezone
    ) {
        Account sourceAccount = new Account(Id = recordId, Name = 'Changed by custom provider');
        update sourceAccount;
        return new Map<String, Object>{
            'Account' => new Map<String, Object>{ 'Id' => recordId, 'Name' => sourceAccount.Name }
        };
    }
}
