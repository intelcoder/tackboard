// @ts-nocheck: the project has no React type packages; esbuild builds this file.
export function PlanCard(props: { name: string; price: string }) {
  return (
    <div className="plan-card">
      <h3>{props.name}</h3>
      <p>{props.price} a month</p>
      <button id="choose-plan">Choose {props.name}</button>
    </div>
  );
}
