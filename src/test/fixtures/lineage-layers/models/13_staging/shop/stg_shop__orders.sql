{{ config(alias="orders") }}

select order_id, amount
from {{ source("shop", "orders") }}
