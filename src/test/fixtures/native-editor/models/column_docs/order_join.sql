-- Join on a passthrough key (customer_id), to pin what Fusion reports for op.
select o.id as order_id, o.customer_id, t.total
from {{ ref('stg_orders') }} o
join {{ ref('order_totals') }} t on o.customer_id = t.customer_id
