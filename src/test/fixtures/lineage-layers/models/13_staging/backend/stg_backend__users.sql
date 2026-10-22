{{ config(alias="users") }}

select user_id, country_code
from (values (1, 'US')) as raw_users(user_id, country_code)
