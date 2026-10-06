with first_cte as (
    select customer_id from {{ ref('stg_orders') }}
),

second_cte as (
    select customer_id from first_cte
)

select * from second_cte
