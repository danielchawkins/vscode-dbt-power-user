{{ config(alias="orders_enriched") }}

with orders as (
    select order_id, amount from {{ ref("stg_shop__orders") }}
),
raw_orders as (
    select order_id, customer_id from {{ source("shop", "orders") }}
),
accounts as (
    select account_id, user_id from {{ ref("stg_backend__accounts") }}
),
users as (
    select user_id, country_code from {{ ref("stg_backend__users") }}
),
countries as (
    select code from {{ ref("country_codes") }}
)

select
    orders.order_id,
    raw_orders.customer_id,
    orders.amount
from orders
left join raw_orders on raw_orders.order_id = orders.order_id
left join accounts on accounts.user_id = raw_orders.customer_id
left join users on users.user_id = accounts.user_id
left join countries on countries.code = users.country_code
