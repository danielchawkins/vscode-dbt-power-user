{{ config(alias="daily_revenue") }}

select
    users.country_code as region,
    sum(orders.amount) as revenue_usd
from {{ ref("int_orders__enriched") }} as orders
left join {{ ref("stg_backend__users") }} as users on users.user_id = orders.customer_id
group by users.country_code
