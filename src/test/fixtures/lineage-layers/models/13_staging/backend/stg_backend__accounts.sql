{{ config(alias="accounts") }}

select account_id, user_id
from (values (1, 1)) as raw_accounts(account_id, user_id)
