select
    orders.order_id,
    orders.customer_id,
    orders.amount as amount_usd,
    current_timestamp as ordered_at
from {{ ref("int_orders__enriched") }} as orders
left join {{ ref("dim_customers") }} as customers on customers.customer_id = orders.customer_id
