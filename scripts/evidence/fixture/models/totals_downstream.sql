select customer_id, total as grand_total from {{ ref('order_totals') }}
