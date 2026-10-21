-- UNION case: customer_id agrees across branches, value differs (orders.amount vs order_totals.total).
select customer_id, amount as value
from {{ source('raw', 'orders') }}
union all
select customer_id, total as value
from {{ ref('order_totals') }}
