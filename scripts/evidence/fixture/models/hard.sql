with j as (
  select o.id, c.name, case when o.status = 'x' then o.amount else 0 end as amt,
         row_number() over (partition by o.customer_id order by o.id) as rn
  from {{ source('raw','orders') }} o join {{ source('raw','customers') }} c on o.customer_id = c.id
  where c.active
)
select id, name as label, amt, rn from j
union all
select user_id, contact, 0, 0 from {{ source('raw','contacts') }}
